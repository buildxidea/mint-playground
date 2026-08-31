import type { BoatCommand } from '../core/BoatInput';

export type BoatState = {
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  yawRate: number;
  steerAngle: number;
  speed: number;
};

export type BoatTuning = {
  forwardAccel: number;
  reverseAccel: number;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  steerResponse: number;
  maxSteer: number;
  turnAuthority: number;
  linearDrag: number;
  lateralDrag: number;
  brakeDrag: number;
  angularDrag: number;
  waterDrift: number;
  hullHalfLength: number;
  hullHalfWidth: number;
};

export const DEFAULT_BOAT_TUNING: BoatTuning = {
  forwardAccel: 7.5,
  reverseAccel: 4.8,
  maxForwardSpeed: 7.2,
  maxReverseSpeed: 3.6,
  steerResponse: 3.2,
  maxSteer: 0.55,
  turnAuthority: 2.4,
  linearDrag: 1.1,
  lateralDrag: 6.5,
  brakeDrag: 4.8,
  angularDrag: 3.2,
  waterDrift: 0.08,
  hullHalfLength: 2.35,
  hullHalfWidth: 0.95,
};

export class BoatPhysics {
  readonly state: BoatState = {
    x: 0,
    z: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    yawRate: 0,
    steerAngle: 0,
    speed: 0,
  };

  constructor(private tuning: BoatTuning = { ...DEFAULT_BOAT_TUNING }) {}

  getTuning(): BoatTuning {
    return this.tuning;
  }

  setTuning(tuning: BoatTuning): void {
    this.tuning = tuning;
  }

  reset(x: number, z: number, yaw: number): void {
    this.state.x = x;
    this.state.z = z;
    this.state.yaw = yaw;
    this.state.vx = 0;
    this.state.vz = 0;
    this.state.yawRate = 0;
    this.state.steerAngle = 0;
    this.state.speed = 0;
  }

  step(
    dt: number,
    command: BoatCommand,
    windForce: { x: number; z: number },
    windTorque: number,
  ): void {
    const t = this.tuning;
    const s = this.state;

    const targetSteer = command.steer * t.maxSteer;
    s.steerAngle += (targetSteer - s.steerAngle) * (1 - Math.exp(-t.steerResponse * dt));

    const forwardX = Math.sin(s.yaw);
    const forwardZ = Math.cos(s.yaw);
    const rightX = Math.cos(s.yaw);
    const rightZ = -Math.sin(s.yaw);

    let ax = 0;
    let az = 0;
    if (command.throttle > 0) {
      ax += forwardX * command.throttle * t.forwardAccel;
      az += forwardZ * command.throttle * t.forwardAccel;
    } else if (command.throttle < 0) {
      ax += forwardX * command.throttle * t.reverseAccel;
      az += forwardZ * command.throttle * t.reverseAccel;
    }

    // Gentle ambient drift + wind.
    ax += windForce.x + forwardX * t.waterDrift * 0.15;
    az += windForce.z + forwardZ * t.waterDrift * 0.15;

    s.vx += ax * dt;
    s.vz += az * dt;

    const forwardSpeed = s.vx * forwardX + s.vz * forwardZ;
    const lateralSpeed = s.vx * rightX + s.vz * rightZ;

    const longDrag = t.linearDrag + command.brake * t.brakeDrag;
    const newForward =
      forwardSpeed * Math.exp(-longDrag * dt) +
      (command.throttle === 0 ? 0 : 0);
    const newLateral = lateralSpeed * Math.exp(-t.lateralDrag * dt);

    s.vx = forwardX * newForward + rightX * newLateral;
    s.vz = forwardZ * newForward + rightZ * newLateral;

    // Speed caps.
    let speed = Math.hypot(s.vx, s.vz);
    const maxSpeed = forwardSpeed >= 0 ? t.maxForwardSpeed : t.maxReverseSpeed;
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      s.vx *= scale;
      s.vz *= scale;
      speed = maxSpeed;
    }
    s.speed = speed;

    const speedFactor = Math.min(1, Math.abs(forwardSpeed) / 2.2);
    const steerSign = forwardSpeed >= 0 ? 1 : -1;
    // Negative: positive steer (D / stick-right) must yaw the bow to screen-right.
    const desiredYawRate =
      -s.steerAngle * t.turnAuthority * (0.25 + 0.75 * speedFactor) * steerSign;
    s.yawRate += (desiredYawRate - s.yawRate) * (1 - Math.exp(-4 * dt));
    s.yawRate *= Math.exp(-t.angularDrag * 0.15 * dt);
    s.yawRate += windTorque * dt;
    s.yaw += s.yawRate * dt;

    s.x += s.vx * dt;
    s.z += s.vz * dt;
  }

  applyImpulse(ix: number, iz: number): void {
    this.state.vx += ix;
    this.state.vz += iz;
  }

  setPosition(x: number, z: number): void {
    this.state.x = x;
    this.state.z = z;
  }
}
