import type { LevelDef } from '../levels/LevelDef';
import type { BoatCommand } from '../core/BoatInput';
import type { BoatState } from './BoatPhysics';
import type { DockingStatus } from './DockingZoneSystem';

/**
 * Waypoint → gate → slip docking autopilot for QA completability sweeps.
 * Supports bow, stern, and parallel approaches.
 */
export class Autopilot {
  private waypointIndex = 0;
  private gateCleared = false;
  private stuckTimer = 0;
  private lastX = 0;
  private lastZ = 0;

  reset(): void {
    this.waypointIndex = 0;
    this.gateCleared = false;
    this.stuckTimer = 0;
    this.lastX = 0;
    this.lastZ = 0;
  }

  step(boat: BoatState, level: LevelDef, docking: DockingStatus): BoatCommand {
    if (docking.complete) {
      return { throttle: 0, steer: 0, brake: 1, retry: false, pause: false, mute: false };
    }

    const moved = Math.hypot(boat.x - this.lastX, boat.z - this.lastZ);
    if (boat.speed < 0.25 && moved < 0.025) this.stuckTimer += 1 / 60;
    else this.stuckTimer = Math.max(0, this.stuckTimer - 1 / 30);
    this.lastX = boat.x;
    this.lastZ = boat.z;

    const slip = level.slip;
    const waypoints = level.waypoints ?? [];
    while (
      this.waypointIndex < waypoints.length &&
      Math.hypot(waypoints[this.waypointIndex]!.x - boat.x, waypoints[this.waypointIndex]!.z - boat.z) < 2.8
    ) {
      this.waypointIndex += 1;
    }

    // Parallel uses the same gate/reverse as stern: approach the mouth opposite
    // the slip facing, then reverse in. Waypoints keep the boat in the slide lane.
    const reverseIn =
      level.approach === 'stern' || level.approach === 'parallel';

    // Keep the gate one full hull length outside the berth without placing it
    // beyond compact basin walls on late reverse-docking levels.
    const approachDist = slip.halfLength + 3.4;
    const gateX = slip.x - Math.sin(slip.yaw) * approachDist;
    const gateZ = slip.z - Math.cos(slip.yaw) * approachDist;
    const gateDist = Math.hypot(gateX - boat.x, gateZ - boat.z);
    if (gateDist < 1.5) this.gateCleared = true;

    let targetX: number;
    let targetZ: number;
    if (this.waypointIndex < waypoints.length) {
      targetX = waypoints[this.waypointIndex]!.x;
      targetZ = waypoints[this.waypointIndex]!.z;
    } else if (!this.gateCleared) {
      targetX = gateX;
      targetZ = gateZ;
    } else {
      // Aim slightly beyond center until the complete hull is inside. A
      // center-only target can stall with the bow or stern still over a gate.
      const dockingLead = docking.inside ? 0 : 0.8;
      targetX = slip.x + Math.sin(slip.yaw) * dockingLead;
      targetZ = slip.z + Math.cos(slip.yaw) * dockingLead;
    }

    return this.steerTo(boat, docking, targetX, targetZ, {
      forceReverse: reverseIn && this.gateCleared,
      forceForward: !reverseIn && this.gateCleared,
      minReverse: reverseIn && this.gateCleared && !docking.inside,
      enableDocking: !reverseIn || this.gateCleared,
      holdYaw: normalizeAngle(slip.yaw + (reverseIn ? Math.PI : 0)),
    });
  }

  private steerTo(
    boat: BoatState,
    docking: DockingStatus,
    targetX: number,
    targetZ: number,
    opts: {
      forceReverse?: boolean;
      forceForward?: boolean;
      minReverse?: boolean;
      enableDocking?: boolean;
      holdYaw?: number;
    },
  ): BoatCommand {
    const dx = targetX - boat.x;
    const dz = targetZ - boat.z;
    const dist = Math.hypot(dx, dz);
    const desiredYaw = Math.atan2(dx, dz);

    let yawErr = normalizeAngle(desiredYaw - boat.yaw);
    const reverseYawErr = normalizeAngle(desiredYaw - boat.yaw - Math.PI);
    let useReverse = Math.abs(reverseYawErr) + 0.15 < Math.abs(yawErr);
    if (opts.forceForward) useReverse = false;
    if (opts.forceReverse) useReverse = true;
    if (useReverse) {
      yawErr = reverseYawErr;
    }
    if (
      opts.enableDocking !== false &&
      (docking.inside || dist < 3.5) &&
      opts.holdYaw !== undefined
    ) {
      // Align on the authored berth axis before the complete hull crosses the
      // gate. The target-point angle becomes unstable near the slip center.
      yawErr = normalizeAngle(opts.holdYaw - boat.yaw);
    }

    const dockingActive = opts.enableDocking !== false && docking.inside;
    if (!dockingActive && this.stuckTimer > 1.2) {
      const escapeReverse = !useReverse;
      return {
        throttle: useReverse ? 0.65 : -0.65,
        steer: clamp((escapeReverse ? 1 : -1) * Math.sign(yawErr || 1) * 0.9, -1, 1),
        brake: 0,
        retry: false,
        pause: false,
        mute: false,
      };
    }

    const steerFor = (gain: number): number =>
      clamp(yawErr * gain * (useReverse ? 1 : -1), -1, 1);
    let steer = steerFor(1.7);
    let throttle = 0;
    let brake = 0;

    if (dockingActive) {
      if (!docking.aligned) {
        throttle = useReverse ? -0.2 : 0.14;
        steer = steerFor(2.6);
        brake = 0.25;
      } else if (!docking.slowEnough) {
        throttle = 0;
        brake = 1;
        steer = steerFor(1.1);
      } else {
        const forwardSpeed = boat.vx * Math.sin(boat.yaw) + boat.vz * Math.cos(boat.yaw);
        throttle = clamp(-forwardSpeed * 0.8, -0.25, 0.25);
        brake = 0.7;
        steer = steerFor(1.5);
      }
    } else if (dist > 9) {
      throttle = useReverse ? -0.75 : 0.9;
      if (Math.abs(yawErr) > 0.75) throttle *= 0.4;
    } else if (dist > 3.5) {
      throttle = useReverse ? -0.5 : 0.58;
      if (Math.abs(yawErr) > 0.5) throttle *= 0.35;
      if (boat.speed > 2.4) brake = 0.45;
    } else {
      throttle = useReverse ? -0.32 : 0.34;
      if (Math.abs(yawErr) > 0.35) throttle *= 0.3;
      if (boat.speed > 1.2) brake = 0.65;
    }

    if (opts.minReverse) {
      throttle = Math.min(throttle, -0.3);
    }

    return {
      throttle: clamp(throttle, -1, 1),
      steer: clamp(steer, -1, 1),
      brake: clamp(brake, 0, 1),
      retry: false,
      pause: false,
      mute: false,
    };
  }
}

function normalizeAngle(a: number): number {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
