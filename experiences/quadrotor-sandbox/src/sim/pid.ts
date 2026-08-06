/** Proportional / integral / derivative gains for one control axis. */
export interface PidGains {
  kp: number;
  ki: number;
  kd: number;
}

export interface PidOptions {
  /** Symmetric clamp on the integral accumulator's contribution. */
  integralLimit?: number;
  /** Symmetric clamp on the returned output. */
  outputLimit?: number;
  /** First-order low-pass cutoff applied to the derivative term, in Hz. */
  derivativeCutoffHz?: number;
}

function clamp(value: number, limit: number) {
  return value > limit ? limit : value < -limit ? -limit : value;
}

/**
 * One PID loop.
 *
 * Two deliberate choices, both of which matter for a flight controller:
 *
 * - **Derivative on measurement, not on error.** Differentiating the error term
 *   makes a step change in setpoint produce an unbounded spike ("derivative
 *   kick"); every stick flick would punch the motors. Differentiating the
 *   measurement instead gives the same damping with no response to setpoint
 *   steps.
 * - **Conditional integration.** The integrator only accumulates when the
 *   output is not already saturated in the same direction, so a sustained
 *   demand the aircraft physically cannot meet does not wind up a reserve of
 *   error that has to unwind before control returns.
 */
export class Pid {
  private integral = 0;
  private lastMeasurement = 0;
  private lastDerivative = 0;
  private primed = false;

  constructor(
    public gains: PidGains,
    private readonly options: PidOptions = {},
  ) {}

  /** Clear all history. Use on arm, mode change, and reset. */
  reset() {
    this.integral = 0;
    this.lastMeasurement = 0;
    this.lastDerivative = 0;
    this.primed = false;
  }

  /** Current integral accumulator, exposed for telemetry and tests. */
  get integralTerm() {
    return this.integral;
  }

  update(setpoint: number, measurement: number, dt: number): number {
    const { kp, ki, kd } = this.gains;
    const { integralLimit, outputLimit, derivativeCutoffHz } = this.options;

    const error = setpoint - measurement;

    // Derivative of the measurement, negated so it still opposes motion.
    let derivative = 0;
    if (this.primed && dt > 0) {
      const raw = -(measurement - this.lastMeasurement) / dt;
      if (derivativeCutoffHz && derivativeCutoffHz > 0) {
        const rc = 1 / (2 * Math.PI * derivativeCutoffHz);
        const a = dt / (rc + dt);
        derivative = this.lastDerivative + a * (raw - this.lastDerivative);
      } else {
        derivative = raw;
      }
    }
    this.lastMeasurement = measurement;
    this.lastDerivative = derivative;
    this.primed = true;

    const unsaturated = kp * error + this.integral + kd * derivative;

    // Conditional integration: hold the accumulator whenever integrating
    // further would push deeper into a limit we are already against.
    if (ki !== 0 && dt > 0) {
      const pushingIntoLimit =
        outputLimit !== undefined &&
        Math.abs(unsaturated) >= outputLimit &&
        Math.sign(error) === Math.sign(unsaturated);

      if (!pushingIntoLimit) {
        this.integral += ki * error * dt;
        if (integralLimit !== undefined) {
          this.integral = clamp(this.integral, integralLimit);
        }
      }
    }

    const output = kp * error + this.integral + kd * derivative;
    return outputLimit === undefined ? output : clamp(output, outputLimit);
  }
}
