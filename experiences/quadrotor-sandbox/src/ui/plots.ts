import type { FlightController } from "../sim/controller";
import type { DroneState } from "../sim/state";

/**
 * Scrolling setpoint-vs-actual traces for the inner rate loop.
 *
 * This is the readout that turns "it feels wobbly" into something you can
 * point at. A well-tuned axis shows the measured trace sitting on top of the
 * commanded one; a detuned axis shows it ringing around it, and the gap
 * between the two lines *is* the error the controller is working on.
 *
 * Drawn on a 2D canvas rather than in the 3D scene: it is a chart, and it
 * costs nothing next to a WebGL pass.
 */

const HISTORY = 260;
const AXES = ["pitch", "roll", "yaw"] as const;
type AxisKey = (typeof AXES)[number];

const AXIS_COLOURS: Record<AxisKey, string> = {
  pitch: "#e08a3c",
  roll: "#63d0ff",
  yaw: "#9ad36b",
};

/** Full-scale deflection of the plots, rad/s. */
const SCALE = 8;

interface Trace {
  setpoint: Float32Array;
  actual: Float32Array;
}

export class RatePlots {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly traces: Record<AxisKey, Trace>;
  private write = 0;
  private filled = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "plots";
    this.canvas.hidden = true;
    container.appendChild(this.canvas);

    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("2D canvas context unavailable for the plots.");
    this.ctx = context;

    this.traces = {
      pitch: { setpoint: new Float32Array(HISTORY), actual: new Float32Array(HISTORY) },
      roll: { setpoint: new Float32Array(HISTORY), actual: new Float32Array(HISTORY) },
      yaw: { setpoint: new Float32Array(HISTORY), actual: new Float32Array(HISTORY) },
    };

    this.resize();
  }

  get visible() {
    return !this.canvas.hidden;
  }

  toggle() {
    this.canvas.hidden = !this.canvas.hidden;
    if (!this.canvas.hidden) this.resize();
  }

  reset() {
    this.write = 0;
    this.filled = 0;
    for (const axis of AXES) {
      this.traces[axis].setpoint.fill(0);
      this.traces[axis].actual.fill(0);
    }
  }

  /** Sample once per rendered frame; the loop runs far faster than the eye. */
  sample(state: DroneState, controller: FlightController) {
    const setpoint = controller.telemetry.rateSetpoint;
    const actual = state.angularVelocity;

    this.traces.pitch.setpoint[this.write] = setpoint.x;
    this.traces.pitch.actual[this.write] = actual.x;
    this.traces.yaw.setpoint[this.write] = setpoint.y;
    this.traces.yaw.actual[this.write] = actual.y;
    this.traces.roll.setpoint[this.write] = setpoint.z;
    this.traces.roll.actual[this.write] = actual.z;

    this.write = (this.write + 1) % HISTORY;
    if (this.filled < HISTORY) this.filled += 1;
  }

  draw() {
    if (this.canvas.hidden) return;

    const { width, height } = this.canvas;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = width / dpr;
    const h = height / dpr;
    const laneHeight = h / AXES.length;

    ctx.clearRect(0, 0, w, h);

    AXES.forEach((axis, index) => {
      const top = index * laneHeight;
      const mid = top + laneHeight / 2;

      // Zero line.
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.42)";
      ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(axis, 6, top + 11);

      const trace = this.traces[axis];
      // Commanded: dim. Measured: bright. The gap is the error.
      this.strokeTrace(trace.setpoint, mid, laneHeight, w, "rgba(255,255,255,0.35)");
      this.strokeTrace(trace.actual, mid, laneHeight, w, AXIS_COLOURS[axis]);
    });
  }

  private strokeTrace(
    data: Float32Array,
    mid: number,
    laneHeight: number,
    width: number,
    colour: string,
  ) {
    if (this.filled < 2) return;

    const ctx = this.ctx;
    const half = (laneHeight / 2) * 0.85;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.25;
    ctx.beginPath();

    for (let i = 0; i < this.filled; i += 1) {
      // Oldest sample first, so the trace scrolls right to left.
      const index = (this.write - this.filled + i + HISTORY * 2) % HISTORY;
      const x = (i / (HISTORY - 1)) * width;
      const clamped = Math.max(-SCALE, Math.min(SCALE, data[index]));
      const y = mid - (clamped / SCALE) * half;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = 300;
    const cssHeight = 150;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
  }
}
