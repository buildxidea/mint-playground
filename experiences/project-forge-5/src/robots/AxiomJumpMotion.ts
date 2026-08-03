export type AxiomJumpPhase = 'grounded' | 'takeoff' | 'ascent' | 'apex' | 'descent' | 'landing';

export type AxiomJumpPresentation = Readonly<{
  active: boolean;
  phase: AxiomJumpPhase;
  phaseProgress: number;
  verticalVelocity: number;
  sequence: number;
}>;

export type AxiomJumpPose = Readonly<{
  weight: number;
  hipsPitchDegrees: number;
  thighPitchDegrees: number;
  kneePitchDegrees: number;
  anklePitchDegrees: number;
  spinePitchDegrees: number;
  upperArmPitchDegrees: number;
  upperArmRollDegrees: number;
  forearmPitchDegrees: number;
  bodyOffsetY: number;
}>;

type JumpStep = Readonly<{
  jumpStarted: boolean;
  grounded: boolean;
  verticalVelocity: number;
}>;

const TAKEOFF_SECONDS = 0.1;
const LANDING_SECONDS = 0.18;
const ASCENT_APEX_VELOCITY = 0.85;
const DESCENT_APEX_VELOCITY = -0.75;
const EXPECTED_LAUNCH_VELOCITY = 5.15;
const EXPECTED_FAST_DESCENT_VELOCITY = -6;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smoothstep = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (value: number): number => 1 - Math.pow(1 - clamp01(value), 3);

function safeVelocity(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function phaseFromAirborneVelocity(verticalVelocity: number): AxiomJumpPhase {
  if (verticalVelocity > ASCENT_APEX_VELOCITY) return 'ascent';
  if (verticalVelocity >= DESCENT_APEX_VELOCITY) return 'apex';
  return 'descent';
}

function progressFromVelocity(phase: AxiomJumpPhase, verticalVelocity: number): number {
  if (phase === 'ascent') {
    return clamp01(
      (EXPECTED_LAUNCH_VELOCITY - verticalVelocity) /
        (EXPECTED_LAUNCH_VELOCITY - ASCENT_APEX_VELOCITY),
    );
  }
  if (phase === 'apex') {
    return clamp01(
      (ASCENT_APEX_VELOCITY - verticalVelocity) /
        (ASCENT_APEX_VELOCITY - DESCENT_APEX_VELOCITY),
    );
  }
  if (phase === 'descent') {
    return clamp01(
      (DESCENT_APEX_VELOCITY - verticalVelocity) /
        (DESCENT_APEX_VELOCITY - EXPECTED_FAST_DESCENT_VELOCITY),
    );
  }
  return 0;
}

export class AxiomJumpController {
  private state: AxiomJumpPresentation = {
    active: false,
    phase: 'grounded',
    phaseProgress: 0,
    verticalVelocity: 0,
    sequence: 0,
  };
  private phaseElapsed = 0;

  get presentation(): AxiomJumpPresentation {
    return this.state;
  }

  step(fixedDt: number, step: JumpStep): AxiomJumpPresentation {
    const dt = Math.max(0, Number.isFinite(fixedDt) ? fixedDt : 0);
    const verticalVelocity = safeVelocity(step.verticalVelocity);

    if (step.jumpStarted) {
      this.phaseElapsed = 0;
      this.state = {
        active: true,
        phase: 'takeoff',
        phaseProgress: 0,
        verticalVelocity,
        sequence: this.state.sequence + 1,
      };
      return this.state;
    }

    this.phaseElapsed += dt;
    let phase = this.state.phase;
    let phaseProgress = this.state.phaseProgress;

    switch (phase) {
      case 'grounded':
        if (!step.grounded) {
          phase = phaseFromAirborneVelocity(verticalVelocity);
          this.phaseElapsed = 0;
        }
        break;
      case 'takeoff':
        phaseProgress = clamp01(this.phaseElapsed / TAKEOFF_SECONDS);
        if (this.phaseElapsed >= TAKEOFF_SECONDS) {
          phase = phaseFromAirborneVelocity(verticalVelocity);
          this.phaseElapsed = 0;
        }
        break;
      case 'ascent':
        phaseProgress = progressFromVelocity(phase, verticalVelocity);
        if (verticalVelocity <= ASCENT_APEX_VELOCITY) {
          phase = phaseFromAirborneVelocity(verticalVelocity);
          this.phaseElapsed = 0;
        }
        break;
      case 'apex':
        phaseProgress = progressFromVelocity(phase, verticalVelocity);
        if (verticalVelocity < DESCENT_APEX_VELOCITY) {
          phase = 'descent';
          this.phaseElapsed = 0;
        }
        break;
      case 'descent':
        phaseProgress = progressFromVelocity(phase, verticalVelocity);
        if (step.grounded) {
          phase = 'landing';
          phaseProgress = 0;
          this.phaseElapsed = 0;
        }
        break;
      case 'landing':
        phaseProgress = clamp01(this.phaseElapsed / LANDING_SECONDS);
        if (!step.grounded) {
          phase = phaseFromAirborneVelocity(verticalVelocity);
          this.phaseElapsed = 0;
        } else if (this.phaseElapsed >= LANDING_SECONDS) {
          phase = 'grounded';
          phaseProgress = 0;
          this.phaseElapsed = 0;
        }
        break;
    }

    if (phase !== this.state.phase) {
      phaseProgress =
        phase === 'ascent' || phase === 'apex' || phase === 'descent'
          ? progressFromVelocity(phase, verticalVelocity)
          : 0;
    }
    this.state = {
      active: phase !== 'grounded',
      phase,
      phaseProgress,
      verticalVelocity,
      sequence: this.state.sequence,
    };
    return this.state;
  }

  reset(): AxiomJumpPresentation {
    const sequence = this.state.sequence;
    this.phaseElapsed = 0;
    this.state = {
      active: false,
      phase: 'grounded',
      phaseProgress: 0,
      verticalVelocity: 0,
      sequence,
    };
    return this.state;
  }
}

export function resolveAxiomJumpPose(jump: AxiomJumpPresentation): AxiomJumpPose {
  const progress = clamp01(jump.phaseProgress);
  switch (jump.phase) {
    case 'takeoff': {
      const compression = 1 - easeOutCubic(progress);
      const extension = Math.sin(progress * Math.PI);
      return {
        weight: 1,
        hipsPitchDegrees: 8 * compression - 5 * extension,
        thighPitchDegrees: -30 * compression + 8 * extension,
        kneePitchDegrees: 56 * compression - 8 * extension,
        anklePitchDegrees: -18 * compression - 12 * extension,
        spinePitchDegrees: 9 * compression - 4 * extension,
        upperArmPitchDegrees: 22 * compression - 34 * extension,
        upperArmRollDegrees: 7 * extension,
        forearmPitchDegrees: 12 * compression + 24 * extension,
        bodyOffsetY: 0.035 * extension,
      };
    }
    case 'ascent': {
      const tuck = smoothstep(progress);
      return {
        weight: 1,
        hipsPitchDegrees: -5 + tuck * 8,
        thighPitchDegrees: 7 - tuck * 26,
        kneePitchDegrees: 8 + tuck * 40,
        anklePitchDegrees: -14 + tuck * 8,
        spinePitchDegrees: -5 + tuck * 9,
        upperArmPitchDegrees: -36 + tuck * 18,
        upperArmRollDegrees: 8 + tuck * 6,
        forearmPitchDegrees: 28 + tuck * 18,
        bodyOffsetY: 0.025 * (1 - tuck),
      };
    }
    case 'apex': {
      const transfer = smoothstep(progress);
      return {
        weight: 1,
        hipsPitchDegrees: 4 + transfer * 3,
        thighPitchDegrees: -22 + transfer * 8,
        kneePitchDegrees: 52 - transfer * 10,
        anklePitchDegrees: -6 + transfer * 9,
        spinePitchDegrees: 5 + transfer * 2,
        upperArmPitchDegrees: -18 + transfer * 22,
        upperArmRollDegrees: 14 + transfer * 4,
        forearmPitchDegrees: 46 - transfer * 12,
        bodyOffsetY: 0,
      };
    }
    case 'descent': {
      const brace = smoothstep(progress);
      return {
        weight: 1,
        hipsPitchDegrees: 7 + brace * 5,
        thighPitchDegrees: -14 - brace * 12,
        kneePitchDegrees: 42 + brace * 14,
        anklePitchDegrees: 3 - brace * 13,
        spinePitchDegrees: 7 + brace * 4,
        upperArmPitchDegrees: 4 + brace * 18,
        upperArmRollDegrees: 18 - brace * 6,
        forearmPitchDegrees: 34 - brace * 16,
        bodyOffsetY: 0,
      };
    }
    case 'landing': {
      const recovery = easeOutCubic(progress);
      const impact = 1 - recovery;
      return {
        weight: impact,
        hipsPitchDegrees: 13 * impact,
        thighPitchDegrees: -34 * impact,
        kneePitchDegrees: 64 * impact,
        anklePitchDegrees: -18 * impact,
        spinePitchDegrees: 12 * impact,
        upperArmPitchDegrees: 24 * impact,
        upperArmRollDegrees: 10 * impact,
        forearmPitchDegrees: 18 * impact,
        bodyOffsetY: 0,
      };
    }
    case 'grounded':
      return {
        weight: 0,
        hipsPitchDegrees: 0,
        thighPitchDegrees: 0,
        kneePitchDegrees: 0,
        anklePitchDegrees: 0,
        spinePitchDegrees: 0,
        upperArmPitchDegrees: 0,
        upperArmRollDegrees: 0,
        forearmPitchDegrees: 0,
        bodyOffsetY: 0,
      };
  }
}
