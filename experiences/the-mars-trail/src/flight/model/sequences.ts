/**
 * Tuning tables for the four flight sequences.
 *
 * Each one needs its own hook or they all become the same dodge loop: the
 * launch is a wide climb with sparse gantry hazards, Kessler is dense fast
 * shrapnel, the fringe is sparse but large slow rocks that demand commitment,
 * and the descent is a tight canyon at speed.
 */

import type { FlightConfig, FlightSequenceId } from './types';

export const SEQUENCES: Record<FlightSequenceId, FlightConfig> = {
  launch: {
    id: 'launch',
    title: 'Ascent',
    place: 'Earth',
    brief:
      'Ignite, throttle up, fly it off the pad. Stage the boosters when they burn out.',
    sceneKey: 'launch-ascent',
    family: 'asteroid',
    durationSeconds: 62,
    leadInSeconds: 0,
    speed: 26,
    boostSpeed: 12,
    spawnDepth: 190,
    capacity: 46,
    // Wide and forgiving: this is the player's first contact with the controls.
    radius: [0.9, 1.9],
    corridorX: 7.5,
    corridorY: 4.6,
    // Scatter well beyond the corridor so the frame is full rather than a
    // column of rocks up the middle.
    spreadFactor: 3.6,
    // Open on cloud; the debris arrives once you are above the weather.
    clearUntil: 0.3,
    hitBudget: 72,
    agility: 15,
  },

  kessler: {
    id: 'kessler',
    title: 'Kessler Belt',
    brief: 'Eighty years of dead satellites on crossing orbits.',
    sceneKey: 'debris-belt',
    family: 'debris',
    durationSeconds: 30,
    speed: 34,
    boostSpeed: 16,
    spawnDepth: 200,
    capacity: 48,
    radius: [0.7, 1.9],
    spreadFactor: 3.2,
    corridorX: 6,
    corridorY: 3.6,
    hitBudget: 40,
    agility: 19,
  },

  'asteroid-fringe': {
    id: 'asteroid-fringe',
    title: 'The Rubble Shoal',
    brief: 'Fewer rocks than the belt, but they are enormous and they do not move out of the way.',
    sceneKey: 'asteroid-fringe',
    family: 'asteroid',
    durationSeconds: 32,
    speed: 28,
    boostSpeed: 14,
    spawnDepth: 210,
    // Sparse but huge: the challenge is route choice, not reaction speed.
    capacity: 34,
    radius: [1.8, 3.6],
    spreadFactor: 3.2,
    corridorX: 8,
    corridorY: 4.6,
    hitBudget: 50,
    agility: 16,
  },

  'mars-descent': {
    id: 'mars-descent',
    title: 'Ares Basin Descent',
    place: 'Mars',
    brief: 'Through the canyon and onto the pad.',
    sceneKey: 'mars-descent',
    family: 'mars-surface',
    durationSeconds: 28,
    speed: 36,
    boostSpeed: 10,
    spawnDepth: 220,
    capacity: 34,
    radius: [1.3, 2.8],
    // Still the tightest corridor in the game, but now threadable.
    spreadFactor: 2.8,
    corridorX: 5.6,
    corridorY: 3.4,
    hitBudget: 50,
    agility: 21,
  },
};

export function sequenceConfig(id: FlightSequenceId): FlightConfig {
  return SEQUENCES[id];
}
