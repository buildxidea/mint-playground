import type { WindDef } from '../levels/LevelDef';

export type WindSample = {
  force: { x: number; z: number };
  torque: number;
  direction: { x: number; z: number };
  strength: number;
  gustFactor: number;
};

/** Smooth, heading-aware harbor wind. Values remain below engine authority. */
export class WindSystem {
  private gustPhase = 0;
  private shiftPhase = 0;
  private base: WindDef;
  private gustAmplitude = 0;

  constructor(
    base: WindDef = { x: 0, z: 0 },
    gustAmplitude = 0,
    private readonly rng: () => number = Math.random,
  ) {
    this.base = base;
    this.gustAmplitude = gustAmplitude;
  }

  set(base: WindDef, gust = base.gust ?? 0): void {
    this.base = base;
    this.gustAmplitude = Math.max(0, gust);
    this.gustPhase = this.rng() * Math.PI * 2;
    this.shiftPhase = this.rng() * Math.PI * 2;
  }

  sample(elapsed: number, boatYaw = 0): WindSample {
    const baseMagnitude = Math.hypot(this.base.x, this.base.z);
    if (baseMagnitude <= 1e-5) {
      return {
        force: { x: 0, z: 0 },
        torque: 0,
        direction: { x: 0, z: 0 },
        strength: 0,
        gustFactor: 0,
      };
    }

    const baseAngle = Math.atan2(this.base.x, this.base.z);
    const shiftRadians = ((this.base.directionShiftDeg ?? 0) * Math.PI) / 180;
    const shift =
      Math.sin(elapsed * 0.22 + this.shiftPhase) * shiftRadians *
      (0.65 + 0.35 * Math.sin(elapsed * 0.09 + this.shiftPhase * 0.4));
    const angle = baseAngle + shift;
    const dirX = Math.sin(angle);
    const dirZ = Math.cos(angle);

    const gustPeriod = Math.max(4, this.base.gustPeriod ?? 9);
    const gustWave =
      (0.5 + 0.5 * Math.sin((elapsed * Math.PI * 2) / gustPeriod + this.gustPhase)) *
      (0.78 + 0.22 * Math.sin(elapsed * 1.37 + this.gustPhase * 0.31));
    const gustFactor = 1 + this.gustAmplitude * gustWave;
    const strength = baseMagnitude * gustFactor;

    const rightX = Math.cos(boatYaw);
    const rightZ = -Math.sin(boatYaw);
    const broadside = Math.abs(dirX * rightX + dirZ * rightZ);
    const exposure = 0.72 + broadside * 0.28;
    const force = {
      x: dirX * strength * exposure,
      z: dirZ * strength * exposure,
    };

    // Symmetric hull axis: either bow or stern may weathercock into the wind.
    const yawError = angle - boatYaw;
    const torque = Math.sin(yawError * 2) * strength * 0.12;
    return { force, torque, direction: { x: dirX, z: dirZ }, strength, gustFactor };
  }

  direction(): { x: number; z: number } {
    return { x: this.base.x, z: this.base.z };
  }
}
