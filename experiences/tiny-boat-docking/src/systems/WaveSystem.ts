import type { SwellComponentDef, WaveDef } from '../levels/LevelDef';

export const MAX_RENDER_SWELLS = 8;
/** One player wake plus the campaign maximum of four traffic wakes. */
export const MAX_RENDER_WAKES = 5;

const GRAVITY = 9.81;
const DEFAULT_HARBOR_DEPTH = 6.5;
const HEIGHT_PER_ENERGY = 0.48;
const WAKE_SURFACE_EPSILON = 0.2;
const INVERSE_GERSTNER_STEPS = 3;

const FAMILY_WEIGHTS = [0.44, 0.2, 0.13, 0.11, 0.07, 0.05] as const;
const FAMILY_LENGTHS = [1, 0.74, 0.52, 1.35, 0.38, 1.75] as const;
const FAMILY_ANGLES = [0, -0.11, 0.14, -0.23, 0.29, -0.36] as const;

export type WakeEmitter = {
  id: string;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  strength: number;
  phase: number;
};

export type SurfaceSample = {
  height: number;
  slopeX: number;
  slopeZ: number;
  normal: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  /** 0..1 geometric convergence/steepness used for crest foam. */
  crest: number;
  wake: number;
};

export type WaveSample = {
  force: { x: number; z: number };
  torque: number;
  /** World-space vertical displacement used by hull presentation. */
  heave: number;
  /** Presentation pitch in radians. */
  pitch: number;
  /** Presentation roll in radians. */
  roll: number;
  /** Combined normalized swell energy for the HUD. */
  amplitude: number;
  /** Local wake intensity at the hull. */
  wake: number;
};

export type RenderSwell = {
  dirX: number;
  dirZ: number;
  height: number;
  waveNumber: number;
  omega: number;
  phase: number;
  steepness: number;
};

export type WaterRenderState = {
  elapsed: number;
  envelope: number;
  energy: number;
  windDirection: { x: number; z: number };
  swells: readonly RenderSwell[];
  wakes: readonly WakeEmitter[];
};

type RuntimeSwell = RenderSwell & { energy: number };

type GerstnerEvaluation = {
  x: number;
  y: number;
  z: number;
  slopeX: number;
  slopeZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  crest: number;
};

/**
 * One deterministic, physically parameterized ocean field drives rendering,
 * gameplay forces, wakes, and every floating presentation body.
 * World basis: +Y up, +Z model/boat forward, XZ water plane, metres/seconds.
 */
export class WaveSystem {
  private readonly swells: RuntimeSwell[] = [];
  private wakes: readonly WakeEmitter[] = [];
  private energy = 0;
  private setStrength = 0;
  private setPeriod = 20;
  private setPhase = 0;
  private depth = DEFAULT_HARBOR_DEPTH;
  private choppiness = 1;
  private windDirection = { x: 0, z: 1 };

  constructor(private readonly rng: () => number = Math.random) {}

  set(params: WaveDef | undefined, windFallback: { x: number; z: number }): void {
    this.swells.length = 0;
    this.energy = 0;
    const windMag = Math.hypot(windFallback.x, windFallback.z);
    const fallbackDirection =
      windMag > 1e-4
        ? { x: windFallback.x / windMag, z: windFallback.z / windMag }
        : { x: 0, z: 1 };

    this.depth = Math.max(1.5, params?.depth ?? DEFAULT_HARBOR_DEPTH);
    this.choppiness = clamp(params?.choppiness ?? 1, 0, 1.35);

    const authored: SwellComponentDef[] = [];
    if (params) {
      authored.push({
        amplitude: Math.max(0, params.amplitude),
        period: Math.max(1.5, params.period),
        wavelength: Math.max(
          4,
          params.wavelength ?? wavelengthForPeriod(params.period, this.depth),
        ),
        direction: params.direction ?? fallbackDirection,
      });
      authored.push(...(params.secondary?.slice(0, 2) ?? []));
      this.setStrength = clamp(params.setStrength ?? 0, 0, 0.5);
      this.setPeriod = Math.max(10, params.setPeriod ?? params.period * 6.5);
    } else if (windMag > 0.08) {
      authored.push({
        amplitude: Math.min(0.3, windMag * 1.35),
        period: 3.8,
        wavelength: wavelengthForPeriod(3.8, this.depth),
        direction: fallbackDirection,
      });
      this.setStrength = 0.05;
      this.setPeriod = 24;
    } else {
      this.setStrength = 0;
      this.setPeriod = 20;
    }

    const allocations = componentAllocations(authored.length);
    authored.forEach((source, index) => {
      this.addSwellFamily(source, allocations[index] ?? 0);
      this.energy += Math.max(0, source.amplitude);
    });

    const first = this.swells[0];
    this.windDirection = first
      ? { x: first.dirX, z: first.dirZ }
      : fallbackDirection;
    this.setPhase = this.rng() * Math.PI * 2;
    this.wakes = [];
  }

  setWakeEmitters(wakes: readonly WakeEmitter[]): void {
    this.wakes = wakes.slice(0, MAX_RENDER_WAKES);
  }

  sample(
    elapsed: number,
    x: number,
    z: number,
    yaw = 0,
    hullHalfLength = 2.35,
    hullHalfWidth = 0.95,
  ): WaveSample {
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    const center = this.sampleSurface(elapsed, x, z);
    const bow = this.sampleSurface(
      elapsed,
      x + forwardX * hullHalfLength,
      z + forwardZ * hullHalfLength,
    );
    const stern = this.sampleSurface(
      elapsed,
      x - forwardX * hullHalfLength,
      z - forwardZ * hullHalfLength,
    );
    const starboard = this.sampleSurface(
      elapsed,
      x + rightX * hullHalfWidth,
      z + rightZ * hullHalfWidth,
    );
    const port = this.sampleSurface(
      elapsed,
      x - rightX * hullHalfWidth,
      z - rightZ * hullHalfWidth,
    );

    const forceLimit = 0.18 + clamp(this.energy, 0, 1.2) * 0.38;
    const force = capVector(
      -center.slopeX * 1.12 + center.velocity.x * 0.075,
      -center.slopeZ * 1.12 + center.velocity.z * 0.075,
      forceLimit,
    );
    const bowLateral = -(bow.slopeX * rightX + bow.slopeZ * rightZ);
    const sternLateral = -(stern.slopeX * rightX + stern.slopeZ * rightZ);
    const torqueLimit = 0.025 + clamp(this.energy, 0, 1.2) * 0.045;
    const torque = clamp((bowLateral - sternLateral) * 0.15, -torqueLimit, torqueLimit);

    return {
      force,
      torque,
      heave:
        (center.height * 2 + bow.height + stern.height + port.height + starboard.height) / 6,
      pitch: Math.atan2(stern.height - bow.height, hullHalfLength * 2),
      roll: Math.atan2(port.height - starboard.height, hullHalfWidth * 2),
      amplitude: this.energy,
      wake: Math.max(center.wake, bow.wake, stern.wake, port.wake, starboard.wake),
    };
  }

  sampleSurface(elapsed: number, x: number, z: number): SurfaceSample {
    const envelope = this.envelope(elapsed);
    const base = this.evaluateAtWorld(elapsed, x, z, envelope);
    const centerWake = this.wakeAt(elapsed, x, z);
    const wakeX0 = this.wakeAt(elapsed, x - WAKE_SURFACE_EPSILON, z).height;
    const wakeX1 = this.wakeAt(elapsed, x + WAKE_SURFACE_EPSILON, z).height;
    const wakeZ0 = this.wakeAt(elapsed, x, z - WAKE_SURFACE_EPSILON).height;
    const wakeZ1 = this.wakeAt(elapsed, x, z + WAKE_SURFACE_EPSILON).height;
    const slopeX =
      base.slopeX + (wakeX1 - wakeX0) / (WAKE_SURFACE_EPSILON * 2);
    const slopeZ =
      base.slopeZ + (wakeZ1 - wakeZ0) / (WAKE_SURFACE_EPSILON * 2);
    const normalLength = Math.hypot(slopeX, 1, slopeZ) || 1;

    return {
      height: base.y + centerWake.height,
      slopeX,
      slopeZ,
      normal: {
        x: -slopeX / normalLength,
        y: 1 / normalLength,
        z: -slopeZ / normalLength,
      },
      velocity: {
        x: base.velocityX,
        y: base.velocityY,
        z: base.velocityZ,
      },
      crest: base.crest,
      wake: centerWake.intensity,
    };
  }

  getRenderState(elapsed: number): WaterRenderState {
    return {
      elapsed,
      envelope: this.envelope(elapsed),
      energy: this.energy,
      windDirection: this.windDirection,
      swells: this.swells,
      wakes: this.wakes,
    };
  }

  getAmplitude(): number {
    return this.energy;
  }

  getComponentCount(): number {
    return this.swells.length;
  }

  getWakeEmitterCount(): number {
    return this.wakes.length;
  }

  private addSwellFamily(value: SwellComponentDef, count: number): void {
    if (count <= 0 || value.amplitude <= 0) return;
    const directionLength = Math.hypot(value.direction.x, value.direction.z) || 1;
    const baseDirX = value.direction.x / directionLength;
    const baseDirZ = value.direction.z / directionLength;
    const baseAngle = Math.atan2(baseDirZ, baseDirX);
    const baseWavelength = Math.max(
      4,
      value.wavelength || wavelengthForPeriod(value.period, this.depth),
    );
    const weightTotal = FAMILY_WEIGHTS.slice(0, count).reduce((sum, weight) => sum + weight, 0);
    const familySteepness = clamp(0.18 + value.amplitude * 0.68, 0.18, 0.82) * this.choppiness;

    for (let index = 0; index < count && this.swells.length < MAX_RENDER_SWELLS; index += 1) {
      const weight = FAMILY_WEIGHTS[index]! / weightTotal;
      const jitter = index === 0 ? 0 : (this.rng() - 0.5) * 0.055;
      const angle = baseAngle + FAMILY_ANGLES[index]! + jitter;
      const wavelength = Math.max(2.8, baseWavelength * FAMILY_LENGTHS[index]!);
      const waveNumber = (Math.PI * 2) / wavelength;
      const height = Math.max(0, value.amplitude) * HEIGHT_PER_ENERGY * weight;
      this.swells.push({
        dirX: Math.cos(angle),
        dirZ: Math.sin(angle),
        height,
        waveNumber,
        omega: Math.sqrt(GRAVITY * waveNumber * Math.tanh(waveNumber * this.depth)),
        phase: this.rng() * Math.PI * 2,
        steepness: familySteepness * (0.92 + weight * 0.18),
        energy: Math.max(0, value.amplitude) * weight,
      });
    }
  }

  private envelope(elapsed: number): number {
    if (this.setStrength <= 0) return 1;
    const wave = 0.5 + 0.5 * Math.sin((elapsed * Math.PI * 2) / this.setPeriod + this.setPhase);
    return 1 - this.setStrength * 0.3 + wave * this.setStrength * 1.3;
  }

  /** Invert horizontal Gerstner displacement so gameplay samples rendered world XZ. */
  private evaluateAtWorld(
    elapsed: number,
    worldX: number,
    worldZ: number,
    envelope: number,
  ): GerstnerEvaluation {
    let parameterX = worldX;
    let parameterZ = worldZ;
    for (let iteration = 0; iteration < INVERSE_GERSTNER_STEPS; iteration += 1) {
      const estimate = this.evaluateAtParameter(elapsed, parameterX, parameterZ, envelope);
      parameterX += worldX - estimate.x;
      parameterZ += worldZ - estimate.z;
    }
    return this.evaluateAtParameter(elapsed, parameterX, parameterZ, envelope);
  }

  private evaluateAtParameter(
    elapsed: number,
    parameterX: number,
    parameterZ: number,
    envelope: number,
  ): GerstnerEvaluation {
    let x = parameterX;
    let y = 0;
    let z = parameterZ;
    let tangentXX = 1;
    let tangentXY = 0;
    let tangentXZ = 0;
    let tangentZX = 0;
    let tangentZY = 0;
    let tangentZZ = 1;
    let velocityX = 0;
    let velocityY = 0;
    let velocityZ = 0;

    for (const swell of this.swells) {
      const amplitude = swell.height * envelope;
      const horizontalAmplitude = amplitude * swell.steepness;
      const phase =
        (parameterX * swell.dirX + parameterZ * swell.dirZ) * swell.waveNumber -
        elapsed * swell.omega +
        swell.phase;
      const sine = Math.sin(phase);
      const cosine = Math.cos(phase);
      const horizontalDerivative = horizontalAmplitude * swell.waveNumber * sine;
      const verticalDerivative = amplitude * swell.waveNumber * cosine;

      x += swell.dirX * horizontalAmplitude * cosine;
      y += amplitude * sine;
      z += swell.dirZ * horizontalAmplitude * cosine;

      tangentXX -= swell.dirX * swell.dirX * horizontalDerivative;
      tangentXY += swell.dirX * verticalDerivative;
      tangentXZ -= swell.dirZ * swell.dirX * horizontalDerivative;
      tangentZX -= swell.dirX * swell.dirZ * horizontalDerivative;
      tangentZY += swell.dirZ * verticalDerivative;
      tangentZZ -= swell.dirZ * swell.dirZ * horizontalDerivative;

      velocityX += swell.dirX * horizontalAmplitude * swell.omega * sine;
      velocityY -= amplitude * swell.omega * cosine;
      velocityZ += swell.dirZ * horizontalAmplitude * swell.omega * sine;
    }

    // tangentZ x tangentX gives the upward-facing normal for a flat XZ plane.
    let normalX = tangentZY * tangentXZ - tangentZZ * tangentXY;
    let normalY = tangentZZ * tangentXX - tangentZX * tangentXZ;
    let normalZ = tangentZX * tangentXY - tangentZY * tangentXX;
    const normalLength = Math.hypot(normalX, normalY, normalZ) || 1;
    normalX /= normalLength;
    normalY /= normalLength;
    normalZ /= normalLength;
    if (normalY < 0) {
      normalX *= -1;
      normalY *= -1;
      normalZ *= -1;
    }
    const safeNormalY = Math.max(normalY, 0.08);
    const jacobian = tangentXX * tangentZZ - tangentXZ * tangentZX;
    const slopeMagnitude = Math.hypot(normalX, normalZ);

    return {
      x,
      y,
      z,
      slopeX: -normalX / safeNormalY,
      slopeZ: -normalZ / safeNormalY,
      normalX,
      normalY,
      normalZ,
      velocityX,
      velocityY,
      velocityZ,
      crest: clamp((1 - jacobian) * 1.45 + slopeMagnitude * 0.28, 0, 1),
    };
  }

  private wakeAt(
    elapsed: number,
    x: number,
    z: number,
  ): { height: number; intensity: number } {
    let height = 0;
    let intensity = 0;
    for (const emitter of this.wakes) {
      if (emitter.speed <= 0.02 || emitter.strength <= 0) continue;
      const dx = x - emitter.x;
      const dz = z - emitter.z;
      const behind = -(dx * emitter.dirX + dz * emitter.dirZ);
      if (behind <= 0 || behind >= 20) continue;
      const lateral = Math.abs(dx * emitter.dirZ - dz * emitter.dirX);
      const ridge = Math.abs(lateral - behind * 0.355);
      const speed = clamp(emitter.speed / 2.4, 0, 1.15);
      const wakeEnvelope =
        (1 - Math.exp(-behind * 1.8)) * Math.exp(-behind * 0.092) * Math.exp(-ridge * 1.55);
      const local = emitter.strength * speed * wakeEnvelope;
      const divergent = Math.sin(behind * 2.35 - elapsed * 2.8 + emitter.phase);
      const transverse = Math.sin(behind * 1.08 - elapsed * 1.9 + emitter.phase * 0.63);
      height += (divergent * 0.72 + transverse * 0.28) * local * 0.072;
      intensity = Math.max(intensity, local);
    }
    return { height, intensity: clamp(intensity, 0, 1) };
  }
}

function componentAllocations(familyCount: number): number[] {
  if (familyCount <= 0) return [];
  if (familyCount === 1) return [6];
  if (familyCount === 2) return [5, 3];
  return [4, 2, 2];
}

/** Solve finite-depth gravity-wave dispersion for wavelength from period. */
function wavelengthForPeriod(periodValue: number, depth: number): number {
  const period = Math.max(1.5, periodValue);
  const omega = (Math.PI * 2) / period;
  let waveNumber = Math.max(0.05, (omega * omega) / GRAVITY);
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const kh = waveNumber * depth;
    const tanh = Math.tanh(kh);
    const cosh = Math.cosh(kh);
    const sechSq = 1 / Math.max(1, cosh * cosh);
    const value = GRAVITY * waveNumber * tanh - omega * omega;
    const derivative = GRAVITY * (tanh + waveNumber * depth * sechSq);
    waveNumber = Math.max(0.01, waveNumber - value / Math.max(derivative, 1e-5));
  }
  return (Math.PI * 2) / waveNumber;
}

function capVector(x: number, z: number, maximum: number): { x: number; z: number } {
  const length = Math.hypot(x, z);
  if (length <= maximum || length <= 1e-6) return { x, z };
  const scale = maximum / length;
  return { x: x * scale, z: z * scale };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
