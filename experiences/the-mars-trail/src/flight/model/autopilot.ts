/**
 * Scripted pilots.
 *
 * These exist so a flight can be exercised without a browser, a WebGL context,
 * or a human: the headless harness replays whole corridors at a fixed timestep
 * and asserts that skill actually maps to outcome. The same mechanism lets the
 * Playwright specs drive a sequence deterministically.
 *
 * It reads exactly the same `FlightRunView` the renderer reads — nothing
 * privileged, no access to the pool's internals.
 */

import type { FlightConfig, FlightInput, FlightInputSource, FlightRunView } from './types';

export interface AutopilotProfile {
  /** 0 = hopeless, 1 = never touches anything. */
  skill: number;
}

/** How far ahead a perfect pilot looks, in world units. */
const MAX_LOOKAHEAD = 70;

/**
 * Candidate positions are sampled on a 2D grid, not a row of lanes.
 * Obstacles are distributed in both axes, so a pilot that only steers left and
 * right cannot avoid anything directly above or below it.
 */
const SAMPLES_X = 9;
const SAMPLES_Y = 7;

/** Clearance below which a candidate position is considered threatened. */
const SAFE_CLEARANCE = 2.4;

export function createAutopilot(
  profile: AutopilotProfile,
  rng: () => number,
  config: FlightConfig,
): FlightInputSource {
  const skill = Math.min(1, Math.max(0, profile.skill));
  // A poor pilot sees less of the corridor and reacts to it worse.
  const lookahead = 12 + MAX_LOOKAHEAD * skill;
  const noise = (1 - skill) * 0.9;
  // A better pilot holds a line more firmly. Damping is scaled alongside the
  // gain to keep the controller near critically damped — raising gain alone
  // made the high-skill pilot overshoot and oscillate, so it clipped more
  // obstacles than a slower, sloppier one.
  const gain = 0.36 + 0.24 * skill;
  const damping = 0.9 * Math.sqrt(gain);

  let driftX = 0;
  let driftY = 0;

  return {
    sample(delta: number, view: FlightRunView): FlightInput {
      // Wander, so a low-skill pilot fails in a varied way rather than sitting
      // perfectly still in the middle of the corridor.
      driftX += (rng() - 0.5) * noise * delta * 9;
      driftY += (rng() - 0.5) * noise * delta * 9;
      driftX *= 0.93;
      driftY *= 0.93;

      // Only bodies ahead and inside the horizon are worth considering; doing
      // this once rather than per-candidate keeps the search cheap.
      const threats = view.bodies.filter(
        (body) => body.active && body.z <= 2.5 && body.z >= -lookahead,
      );

      let bestX = 0;
      let bestY = 0;
      let bestScore = -Infinity;

      for (let ix = 0; ix < SAMPLES_X; ix += 1) {
        const candidateX = ((ix / (SAMPLES_X - 1)) - 0.5) * 2 * config.corridorX * 0.92;

        for (let iy = 0; iy < SAMPLES_Y; iy += 1) {
          const candidateY = ((iy / (SAMPLES_Y - 1)) - 0.5) * 2 * config.corridorY * 0.92;

          // Prefer positions close to where the ship already is: a real pilot
          // does not cross the whole corridor for a marginally better gap.
          let score =
            -Math.abs(candidateX - view.shipX) * 0.3 - Math.abs(candidateY - view.shipY) * 0.3;

          for (const body of threats) {
            const dx = body.x - candidateX;
            const dy = body.y - candidateY;
            const planar = Math.sqrt(dx * dx + dy * dy);
            const clearance = planar - body.r;
            if (clearance < SAFE_CLEARANCE) {
              // Inverse-square falloff on distance, not a linear ramp. With a
              // linear one, a long-horizon pilot summed dozens of far-away
              // threats until they outweighed the object directly in front of
              // it, and it oscillated — scoring *worse* than a short-sighted
              // pilot. Here anything beyond ~25 units contributes almost
              // nothing, so a longer horizon only ever adds early warning.
              const ahead = Math.max(0, -body.z);
              const proximity = 1 / (1 + (ahead / 8) * (ahead / 8));
              score -= (SAFE_CLEARANCE - clearance) * (1 + proximity * 14);
            }
          }

          if (score > bestScore) {
            bestScore = score;
            bestX = candidateX;
            bestY = candidateY;
          }
        }
      }

      const targetX = bestX + driftX;
      const targetY = bestY + driftY;

      // Proportional-derivative steering toward the chosen gap.
      const x = Math.max(-1, Math.min(1, (targetX - view.shipX) * gain - view.shipVX * damping));
      const y = Math.max(-1, Math.min(1, (targetY - view.shipY) * gain - view.shipVY * damping));

      // Drive the launch sequence too: without ignition and staging the bots
    // would sit on the pad forever and every headless run would time out.
    const stage = view.stage;
    const launchInput = {
      throttleUp: stage === 'ignition' || stage === 'boost' || stage === 'staged',
      throttleDown: false,
      ignitePressed: stage === 'pad',
      stagePressed: stage === 'boost' && view.altitude > 150,
    };

    return {
      ...launchInput, x, y, boost: false, brake: false };
    },
  };
}
