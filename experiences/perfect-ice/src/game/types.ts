export type GamePhase = 'intro' | 'playing' | 'paused' | 'complete' | 'failed';

export type ObstacleKind = 'cone' | 'goal' | 'bench' | 'barrier' | 'puck' | 'equipment';

export type CircleShape = {
  type: 'circle';
  radius: number;
};

export type BoxShape = {
  type: 'box';
  halfWidth: number;
  halfDepth: number;
};

export type ObstacleDefinition = {
  id: string;
  kind: ObstacleKind;
  x: number;
  z: number;
  rotation?: number;
  shape: CircleShape | BoxShape;
};

export type LevelDefinition = {
  id: string;
  number: number;
  name: string;
  subtitle: string;
  briefing: string;
  halfWidth: number;
  halfDepth: number;
  cornerRadius: number;
  start: { x: number; z: number; heading: number };
  obstacles: ObstacleDefinition[];
  coverageTarget: number;
  parTime: number;
  maxTime: number;
  waterCapacity: number;
  fuelCapacity: number;
  waterPerSecond: number;
  waterPerMetre: number;
  fuelPerMetre: number;
};

export type CoverageStats = {
  coverage: number;
  cleanedCells: number;
  requiredCells: number;
  productiveCells: number;
  repeatedCells: number;
  wastedCells: number;
  overlapRatio: number;
};

export type RunStats = CoverageStats & {
  elapsed: number;
  drivenDistance: number;
  water: number;
  fuel: number;
  wastedWater: number;
  collisions: number;
};

export type ScoreBreakdown = {
  total: number;
  stars: number;
  coverage: number;
  efficiency: number;
  time: number;
  resources: number;
  penalties: number;
};
