import { Vector3 } from "three";

/** Small, fast, seedable PRNG. Deterministic across platforms. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Octave {
  frequency: number;
  phase: number;
  amplitude: number;
}

const OCTAVE_COUNT = 4;

/**
 * Steady wind plus turbulence.
 *
 * Gusts are a fixed sum of sinusoids with incommensurate frequencies and
 * seeded phases rather than sampled noise: it is smooth, allocation-free, and
 * — the reason it matters here — perfectly reproducible, so a recorded flight
 * replays through identical air.
 */
export class Wind {
  /** Steady wind speed, m/s. */
  speed = 0;
  /** Compass heading the wind blows *toward*, radians clockwise from -Z. */
  heading = 0;
  /** Turbulence intensity, 0 = still air, 1 = strong gusts. */
  gustiness = 0.25;

  private readonly octaves: Octave[][] = [];
  private readonly scratch = new Vector3();
  private time = 0;

  constructor(seed = 0x5eed) {
    const rand = mulberry32(seed);
    for (let axis = 0; axis < 3; axis += 1) {
      const set: Octave[] = [];
      for (let i = 0; i < OCTAVE_COUNT; i += 1) {
        set.push({
          // Spread from slow swells to quick buffeting.
          frequency: 0.12 * Math.pow(2.37, i) * (0.75 + rand() * 0.5),
          phase: rand() * Math.PI * 2,
          amplitude: 1 / Math.pow(1.9, i),
        });
      }
      this.octaves.push(set);
    }
  }

  reset() {
    this.time = 0;
  }

  step(dt: number) {
    this.time += dt;
  }

  /** Wind velocity at the current time, m/s, written into a shared vector. */
  velocity(): Vector3 {
    const steadyX = Math.sin(this.heading) * this.speed;
    const steadyZ = -Math.cos(this.heading) * this.speed;

    // Gust magnitude scales with the steady wind but keeps a floor, so
    // turbulence is still felt in nominally calm air.
    const scale = this.gustiness * (1.5 + this.speed * 0.45);

    this.scratch.set(
      steadyX + this.gust(0) * scale,
      this.gust(1) * scale * 0.5,
      steadyZ + this.gust(2) * scale,
    );
    return this.scratch;
  }

  private gust(axis: number) {
    const set = this.octaves[axis];
    let sum = 0;
    let norm = 0;
    for (const o of set) {
      sum += Math.sin(this.time * o.frequency * Math.PI * 2 + o.phase) * o.amplitude;
      norm += o.amplitude;
    }
    return sum / norm;
  }
}
