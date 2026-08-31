import type { SlipDef } from '../levels/LevelDef';
import { DEFAULT_BOAT_TUNING, type BoatState, type BoatTuning } from './BoatPhysics';

export type DockingStatus = {
  inside: boolean;
  aligned: boolean;
  slowEnough: boolean;
  holdProgress: number;
  complete: boolean;
  missedApproach: boolean;
  posError: number;
  yawErrorDeg: number;
};

export class DockingZoneSystem {
  private hold = 0;
  private wasInside = false;
  private complete = false;
  private missed = false;
  private last: DockingStatus = {
    inside: false,
    aligned: false,
    slowEnough: false,
    holdProgress: 0,
    complete: false,
    missedApproach: false,
    posError: 1,
    yawErrorDeg: 180,
  };

  reset(): void {
    this.hold = 0;
    this.wasInside = false;
    this.complete = false;
    this.missed = false;
    this.last = {
      inside: false,
      aligned: false,
      slowEnough: false,
      holdProgress: 0,
      complete: false,
      missedApproach: false,
      posError: 1,
      yawErrorDeg: 180,
    };
  }

  getStatus(): DockingStatus {
    return this.last;
  }

  update(
    dt: number,
    boat: BoatState,
    slip: SlipDef,
    hull: Pick<BoatTuning, 'hullHalfLength' | 'hullHalfWidth'> = DEFAULT_BOAT_TUNING,
  ): DockingStatus {
    if (this.complete) {
      this.last = {
        inside: true,
        aligned: true,
        slowEnough: true,
        holdProgress: 1,
        complete: true,
        missedApproach: false,
        posError: 0,
        yawErrorDeg: 0,
      };
      return this.last;
    }

    const local = worldToSlip(boat.x, boat.z, slip);
    const relativeYaw = normalizeAngle(boat.yaw - slip.yaw);
    const projectedHalfWidth =
      Math.abs(Math.cos(relativeYaw)) * hull.hullHalfWidth +
      Math.abs(Math.sin(relativeYaw)) * hull.hullHalfLength;
    const projectedHalfLength =
      Math.abs(Math.cos(relativeYaw)) * hull.hullHalfLength +
      Math.abs(Math.sin(relativeYaw)) * hull.hullHalfWidth;
    const inside =
      Math.abs(local.x) + projectedHalfWidth <= slip.halfWidth &&
      Math.abs(local.z) + projectedHalfLength <= slip.halfLength;

    let yawError = Math.abs(normalizeAngle(boat.yaw - slip.yaw));
    // Accept facing either direction into the slip (forward or reverse docked).
    yawError = Math.min(yawError, Math.abs(normalizeAngle(boat.yaw - slip.yaw - Math.PI)));
    const yawErrorDeg = (yawError * 180) / Math.PI;
    const aligned = yawErrorDeg <= slip.yawToleranceDeg;
    const slowEnough = boat.speed <= slip.maxHoldSpeed;
    const posError = Math.hypot(local.x / slip.halfWidth, local.z / slip.halfLength);

    if (inside && aligned && slowEnough) {
      this.hold += dt;
    } else if (inside) {
      this.hold = Math.max(0, this.hold - dt * 0.65);
    } else {
      if (this.wasInside && this.hold > 0.15) {
        this.missed = true;
      }
      this.hold = 0;
    }

    this.wasInside = inside;
    const holdProgress = Math.min(1, this.hold / slip.holdSeconds);
    if (holdProgress >= 1) {
      this.complete = true;
    }

    const missedApproach = this.missed;
    this.missed = false;

    this.last = {
      inside,
      aligned,
      slowEnough,
      holdProgress,
      complete: this.complete,
      missedApproach,
      posError,
      yawErrorDeg,
    };
    return this.last;
  }
}

function worldToSlip(x: number, z: number, slip: SlipDef): { x: number; z: number } {
  const dx = x - slip.x;
  const dz = z - slip.z;
  const c = Math.cos(-slip.yaw);
  const s = Math.sin(-slip.yaw);
  return {
    x: dx * c - dz * s,
    z: dx * s + dz * c,
  };
}

function normalizeAngle(a: number): number {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
}
