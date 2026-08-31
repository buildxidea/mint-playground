export const CORRIDOR = {
  halfWidth: 16,
  minY: 1.6,
  maxY: 28,
  seabedY: 0,
};

export const SWIM = {
  baseSpeed: 14,
  boostSpeed: 23,
  bounceSpeed: 36,
  stingSpeed: 7,
  forwardAccel: 9,
  bounceDecay: 4.5,
  lateralSpeed: 17,
  verticalSpeed: 14,
  steerAccel: 13,
  boostDrainSeconds: 2.4,
  boostRegenSeconds: 4.5,
  stingInvulnSeconds: 1.6,
  fishRadius: 0.9,
};

export const SPAWN = {
  chunkLength: 70,
  chunksAhead: 5,
  despawnBehind: 30,
  ringRadius: 2.3,
  ringsPerChunkMin: 3,
  ringsPerChunkMax: 5,
  jelliesPerChunkMin: 4,
  jelliesPerChunkMax: 8,
  backgroundJellies: 55,
  propsPerChunk: 10,
};

export const SCORING = {
  ringPoints: 100,
  comboMax: 8,
  stingPenalty: 150,
  ringSpeedBump: 3,
};

export const JELLY = {
  capRadius: 1.9,
  tentacleRadius: 1.1,
  tentacleLength: 4.2,
  bounceCooldown: 0.7,
};

export const CAMERA = {
  offset: { x: 0, y: 2.6, z: 8.2 },
  lookAhead: { x: 0, y: 0.2, z: -7 },
  lag: 0.11,
  baseFov: 55,
  maxFov: 74,
};
