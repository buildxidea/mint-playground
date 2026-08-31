import * as THREE from 'three';
import type { WaveSystem } from './WaveSystem';

export type FloatingBodyKind = 'player' | 'traffic' | 'moored-boat' | 'buoy' | 'pontoon';

export type FloatingPose = {
  x: number;
  z: number;
  yaw: number;
};

export type FloatingBodySpec = {
  id: string;
  kind: FloatingBodyKind;
  root: THREE.Object3D;
  halfLength: number;
  halfWidth: number;
  restY?: number;
  getPose: () => FloatingPose;
  /** Hydrodynamic trim/failure offsets, added after the wave response. */
  getPresentationOffset?: () => { y?: number; pitch: number; roll: number };
};

type SpringAxis = {
  value: number;
  velocity: number;
};

type FloatingState = {
  initialized: boolean;
  heave: SpringAxis;
  pitch: SpringAxis;
  roll: SpringAxis;
};

type ResponseProfile = {
  heave: number;
  tilt: number;
  frequencyHz: number;
  damping: number;
};

export type FloatingBodyDiagnostics = {
  total: number;
  byKind: Record<FloatingBodyKind, number>;
  maxHeave: number;
  maxPitch: number;
  maxRoll: number;
};

const RESPONSE: Record<FloatingBodyKind, ResponseProfile> = {
  player: { heave: 1, tilt: 1, frequencyHz: 0.72, damping: 0.86 },
  traffic: { heave: 0.94, tilt: 0.88, frequencyHz: 0.66, damping: 0.88 },
  'moored-boat': { heave: 0.82, tilt: 0.7, frequencyHz: 0.5, damping: 0.92 },
  buoy: { heave: 1.06, tilt: 0.98, frequencyHz: 0.94, damping: 0.78 },
  pontoon: { heave: 0.34, tilt: 0.18, frequencyHz: 0.34, damping: 0.96 },
};

/**
 * Applies mass-specific damped wave response to every visual body that floats.
 * Canonical XZ/yaw stay owned by gameplay/level systems; this owns Y/pitch/roll.
 */
export class FloatingBodySystem {
  private readonly specs: FloatingBodySpec[] = [];
  private readonly states = new Map<string, FloatingState>();
  private diagnostics: FloatingBodyDiagnostics = emptyDiagnostics();

  configure(specs: readonly FloatingBodySpec[]): void {
    this.specs.length = 0;
    this.specs.push(...specs);
    this.states.clear();
    const byKind = emptyKindCounts();
    for (const spec of this.specs) {
      if (this.states.has(spec.id)) {
        throw new Error(`Duplicate floating body id: ${spec.id}`);
      }
      this.states.set(spec.id, createState());
      byKind[spec.kind] += 1;
      spec.root.rotation.order = 'YXZ';
    }
    this.diagnostics = {
      total: this.specs.length,
      byKind,
      maxHeave: 0,
      maxPitch: 0,
      maxRoll: 0,
    };
  }

  update(
    deltaSeconds: number,
    elapsed: number,
    waves: WaveSystem,
    reducedMotion: boolean,
  ): void {
    const dt = THREE.MathUtils.clamp(deltaSeconds, 0, 1 / 30);
    const motionScale = reducedMotion ? 0.22 : 1;
    const seaEnergy = THREE.MathUtils.clamp(waves.getAmplitude(), 0, 1.2);
    const maxHeave = 0.1 + seaEnergy * 0.52;
    const maxTilt = THREE.MathUtils.degToRad(4 + (seaEnergy / 1.2) * 23);
    let measuredHeave = 0;
    let measuredPitch = 0;
    let measuredRoll = 0;

    for (const spec of this.specs) {
      const state = this.states.get(spec.id);
      if (!state) continue;
      const profile = RESPONSE[spec.kind];
      const pose = spec.getPose();
      const sample = waves.sample(
        elapsed,
        pose.x,
        pose.z,
        pose.yaw,
        Math.max(0.18, spec.halfLength),
        Math.max(0.18, spec.halfWidth),
      );
      const extra = spec.getPresentationOffset?.() ?? { pitch: 0, roll: 0 };
      const targetHeave = THREE.MathUtils.clamp(
        sample.heave * profile.heave * motionScale,
        -maxHeave * profile.heave,
        maxHeave * profile.heave,
      );
      const targetPitch = THREE.MathUtils.clamp(
        sample.pitch * profile.tilt * motionScale,
        -maxTilt * profile.tilt,
        maxTilt * profile.tilt,
      ) + extra.pitch;
      const targetRoll = THREE.MathUtils.clamp(
        sample.roll * profile.tilt * motionScale,
        -maxTilt * profile.tilt,
        maxTilt * profile.tilt,
      ) + extra.roll;

      if (!state.initialized || dt <= 0) {
        state.heave.value = targetHeave;
        state.pitch.value = targetPitch;
        state.roll.value = targetRoll;
        state.initialized = true;
      } else {
        stepSpring(state.heave, targetHeave, profile, dt);
        stepSpring(state.pitch, targetPitch, profile, dt);
        stepSpring(state.roll, targetRoll, profile, dt);
      }

      spec.root.position.set(
        pose.x,
        (spec.restY ?? 0) + state.heave.value + (extra.y ?? 0),
        pose.z,
      );
      spec.root.rotation.y = pose.yaw;
      spec.root.rotation.x = state.pitch.value;
      spec.root.rotation.z = state.roll.value;

      measuredHeave = Math.max(measuredHeave, Math.abs(state.heave.value));
      measuredPitch = Math.max(measuredPitch, Math.abs(state.pitch.value));
      measuredRoll = Math.max(measuredRoll, Math.abs(state.roll.value));
    }

    this.diagnostics.maxHeave = measuredHeave;
    this.diagnostics.maxPitch = measuredPitch;
    this.diagnostics.maxRoll = measuredRoll;
  }

  getDiagnostics(): FloatingBodyDiagnostics {
    return {
      ...this.diagnostics,
      byKind: { ...this.diagnostics.byKind },
    };
  }

  clear(): void {
    this.specs.length = 0;
    this.states.clear();
    this.diagnostics = emptyDiagnostics();
  }
}

function stepSpring(
  axis: SpringAxis,
  target: number,
  profile: ResponseProfile,
  dt: number,
): void {
  const omega = Math.PI * 2 * profile.frequencyHz;
  const acceleration =
    omega * omega * (target - axis.value) -
    2 * profile.damping * omega * axis.velocity;
  axis.velocity += acceleration * dt;
  axis.value += axis.velocity * dt;
}

function createState(): FloatingState {
  return {
    initialized: false,
    heave: { value: 0, velocity: 0 },
    pitch: { value: 0, velocity: 0 },
    roll: { value: 0, velocity: 0 },
  };
}

function emptyKindCounts(): Record<FloatingBodyKind, number> {
  return {
    player: 0,
    traffic: 0,
    'moored-boat': 0,
    buoy: 0,
    pontoon: 0,
  };
}

function emptyDiagnostics(): FloatingBodyDiagnostics {
  return {
    total: 0,
    byKind: emptyKindCounts(),
    maxHeave: 0,
    maxPitch: 0,
    maxRoll: 0,
  };
}
