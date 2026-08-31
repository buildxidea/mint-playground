import type {
  DifficultyDef,
  LevelDef,
  TrafficBoatDef,
  TrafficBoatModel,
  Vec2,
  WaveDef,
  WindDef,
} from './LevelDef';

type LevelLayout = Omit<LevelDef, 'difficulty' | 'traffic'>;
type PrecisionTuning = Pick<
  LevelDef['slip'],
  'halfWidth' | 'yawToleranceDeg' | 'maxHoldSpeed' | 'holdSeconds'
>;

const point = (x: number, z: number): Vec2 => ({ x, z });

const trafficBoat = (
  model: TrafficBoatModel,
  speed: number,
  phase: number,
  wakeStrength: number,
  behavior: TrafficBoatDef['behavior'],
  route: Vec2[],
): TrafficBoatDef => ({ model, speed, phase, wakeStrength, behavior, route });

const crossSwell = (
  amplitude: number,
  period: number,
  direction: Vec2,
): NonNullable<WaveDef['secondary']>[number] => ({
  amplitude,
  period,
  wavelength: period * 3.1,
  direction,
});

const wave = (
  amplitude: number,
  period: number,
  direction: Vec2,
  setStrength: number,
  secondary: NonNullable<WaveDef['secondary']> = [],
): WaveDef => ({
  amplitude,
  period,
  wavelength: period * 3.4,
  direction,
  secondary,
  setStrength,
  setPeriod: Math.max(12, period * 6.5),
});

const wind = (
  x: number,
  z: number,
  gust: number,
  gustPeriod: number,
  directionShiftDeg: number,
): WindDef => ({ x, z, gust, gustPeriod, directionShiftDeg });

const DIFFICULTY: DifficultyDef[] = [
  { rank: 1, route: 0.5, precision: 0.5, traffic: 0, weather: 0.2 },
  { rank: 2, route: 0.8, precision: 0.7, traffic: 0.7, weather: 0.5 },
  { rank: 3, route: 1.1, precision: 1.0, traffic: 1.0, weather: 0.8 },
  { rank: 4, route: 1.4, precision: 1.3, traffic: 1.2, weather: 1.0 },
  { rank: 5, route: 1.7, precision: 1.6, traffic: 1.4, weather: 1.3 },
  { rank: 6, route: 2.0, precision: 1.9, traffic: 1.8, weather: 1.7 },
  { rank: 7, route: 2.5, precision: 2.1, traffic: 1.9, weather: 1.9 },
  { rank: 8, route: 2.7, precision: 2.4, traffic: 2.3, weather: 2.2 },
  { rank: 9, route: 2.9, precision: 2.6, traffic: 2.6, weather: 2.5 },
  { rank: 10, route: 3.2, precision: 3.0, traffic: 2.9, weather: 2.9 },
  { rank: 11, route: 3.5, precision: 3.3, traffic: 3.4, weather: 3.2 },
  { rank: 12, route: 3.8, precision: 3.6, traffic: 3.7, weather: 3.6 },
  { rank: 13, route: 4.1, precision: 4.0, traffic: 4.1, weather: 4.0 },
  { rank: 14, route: 4.5, precision: 4.5, traffic: 4.5, weather: 4.6 },
  { rank: 15, route: 5.0, precision: 5.0, traffic: 5.0, weather: 5.0 },
];

const TRAFFIC: TrafficBoatDef[][] = [
  [],
  [
    trafficBoat('boat_teal_skiff', 1.35, 0.15, 0.28, 'yielding', [
      point(-13, 13.5),
      point(0, 13.5),
      point(12, 13.5),
      point(12, 14.5),
      point(12, 15.5),
      point(0, 15.5),
      point(-13, 15.5),
      point(-13, 14.5),
    ]),
  ],
  [
    trafficBoat('boat_yellow_utility', 1.5, 0.55, 0.34, 'yielding', [
      point(-15, -2.8),
      point(-7, -2.8),
      point(-1, -2.8),
      point(-1, -4.2),
      point(-1, -5.6),
      point(-7, -5.6),
      point(-15, -5.6),
      point(-15, -4.2),
    ]),
  ],
  [
    trafficBoat('boat_teal_skiff', 1.55, 0.3, 0.38, 'yielding', [
      point(-2.2, 6),
      point(-2.2, -1),
      point(2.2, -1),
      point(2.2, 6),
    ]),
  ],
  [
    trafficBoat('boat_red_runabout', 1.65, 0.1, 0.42, 'yielding', [
      point(-8, 7),
      point(-4, 7),
      point(0, 7),
      point(0, 8.5),
      point(0, 10),
      point(-4, 10),
      point(-8, 10),
      point(-8, 8.5),
    ]),
  ],
  [
    trafficBoat('boat_teal_skiff', 1.7, 0.1, 0.46, 'yielding', [
      point(-1.5, -11),
      point(-1.5, -4),
      point(-1.5, 1.5),
      point(0, 1.5),
      point(1.5, 1.5),
      point(1.5, -4),
      point(1.5, -11),
      point(0, -11),
    ]),
    trafficBoat('boat_yellow_utility', 1.6, 0.62, 0.43, 'yielding', [
      point(1.5, -11),
      point(1.5, -4),
      point(1.5, 1.5),
      point(0, 1.5),
      point(-1.5, 1.5),
      point(-1.5, -4),
      point(-1.5, -11),
      point(0, -11),
    ]),
  ],
  [
    trafficBoat('boat_yellow_utility', 1.55, 0.42, 0.45, 'yielding', [
      point(-10.5, -15.3),
      point(-8.5, -15.3),
      point(-6.5, -15.3),
      point(-6.5, -14.3),
      point(-6.5, -13.3),
      point(-8.5, -13.3),
      point(-10.5, -13.3),
      point(-10.5, -14.3),
    ]),
  ],
  [
    trafficBoat('boat_teal_skiff', 1.75, 0.12, 0.5, 'steady', [
      point(16.2, -15),
      point(16.2, 0),
      point(16.2, 15),
      point(16.5, 15),
      point(16.8, 15),
      point(16.8, 0),
      point(16.8, -15),
      point(16.5, -15),
    ]),
    trafficBoat('boat_yellow_utility', 1.6, 0.62, 0.47, 'yielding', [
      point(3, -15.3),
      point(5, -15.3),
      point(7, -15.3),
      point(7, -14.3),
      point(7, -13.3),
      point(5, -13.3),
      point(3, -13.3),
      point(3, -14.3),
    ]),
  ],
  [
    trafficBoat('boat_red_runabout', 1.8, 0.08, 0.54, 'steady', [
      point(-12, -3.5),
      point(-2, -3.5),
      point(9, -3.5),
      point(9, -3),
      point(9, -2.5),
      point(-2, -2.5),
      point(-12, -2.5),
      point(-12, -3),
    ]),
    trafficBoat('boat_yellow_utility', 1.7, 0.57, 0.5, 'steady', [
      point(-1, 1.5),
      point(2, 1.5),
      point(5, 1.5),
      point(5, 2),
      point(5, 2.5),
      point(2, 2.5),
      point(-1, 2.5),
      point(-1, 2),
    ]),
  ],
  [
    trafficBoat('boat_teal_skiff', 1.85, 0.18, 0.58, 'steady', [
      point(-10, 13.5),
      point(-1, 13.5),
      point(8, 13.5),
      point(8, 14.4),
      point(8, 15.3),
      point(-1, 15.3),
      point(-10, 15.3),
      point(-10, 14.4),
    ]),
    trafficBoat('boat_yellow_utility', 1.75, 0.68, 0.54, 'steady', [
      point(1, 4),
      point(2.75, 4),
      point(4.5, 4),
      point(4.5, 5),
      point(4.5, 6),
      point(2.75, 6),
      point(1, 6),
      point(1, 5),
    ]),
  ],
  [
    trafficBoat('boat_teal_skiff', 1.8, 0.05, 0.6, 'steady', [
      point(-2, 9),
      point(-2, -2),
      point(2, -2),
      point(2, 9),
    ]),
    trafficBoat('boat_yellow_utility', 1.7, 0.38, 0.57, 'steady', [
      point(-10, 13),
      point(0, 13),
      point(10, 13),
      point(10, 14.15),
      point(10, 15.3),
      point(0, 15.3),
      point(-10, 15.3),
      point(-10, 14.15),
    ]),
    trafficBoat('boat_red_runabout', 1.65, 0.74, 0.55, 'steady', [
      point(-2.3, 3.6),
      point(0, 3.6),
      point(2.3, 3.6),
      point(2.3, 4),
      point(2.3, 4.4),
      point(0, 4.4),
      point(-2.3, 4.4),
      point(-2.3, 4),
    ]),
  ],
  [
    trafficBoat('boat_red_runabout', 1.9, 0.02, 0.64, 'steady', [
      point(-10, 13.5),
      point(0, 13.5),
      point(10, 13.5),
      point(10, 14.4),
      point(10, 15.3),
      point(0, 15.3),
      point(-10, 15.3),
      point(-10, 14.4),
    ]),
    trafficBoat('boat_teal_skiff', 1.75, 0.37, 0.6, 'steady', [
      point(-7, 3),
      point(-3.5, 3),
      point(0, 3),
      point(0, 3.5),
      point(0, 4),
      point(-3.5, 4),
      point(-7, 4),
      point(-7, 3.5),
    ]),
    trafficBoat('boat_yellow_utility', 1.7, 0.72, 0.58, 'steady', [
      point(-9, -2.5),
      point(-4.5, -2.5),
      point(0, -2.5),
      point(0, -2),
      point(0, -1.5),
      point(-4.5, -1.5),
      point(-9, -1.5),
      point(-9, -2),
    ]),
  ],
  [
    // Keep two boats in exterior harbor lanes so the alley always has an
    // escape path. One yielding boat crosses the mouth as a timed hazard.
    trafficBoat('boat_red_runabout', 1.85, 0.1, 0.68, 'steady', [
      point(6.5, 8.5),
      point(8, 8.5),
      point(9.5, 8.5),
      point(9.5, 9.5),
      point(9.5, 10.5),
      point(8, 10.5),
      point(6.5, 10.5),
      point(6.5, 9.5),
    ]),
    trafficBoat('boat_teal_skiff', 1.75, 0.38, 0.64, 'steady', [
      point(6.5, -10.5),
      point(8, -10.5),
      point(9.5, -10.5),
      point(9.5, -9.5),
      point(9.5, -8.5),
      point(8, -8.5),
      point(6.5, -8.5),
      point(6.5, -9.5),
    ]),
    trafficBoat('boat_yellow_utility', 1.65, 0.03, 0.62, 'yielding', [
      point(12, -8),
      point(12, -2.5),
      point(12, 8),
      point(13, 8),
      point(13, 2.5),
      point(13, -8),
      point(12.5, -8.5),
      point(12, -8),
    ]),
  ],
  [
    trafficBoat('boat_teal_skiff', 2.0, 0.08, 0.74, 'steady', [
      point(3, -11),
      point(3, -5),
      point(3, 0.5),
      point(4.5, 0.5),
      point(6, 0.5),
      point(6, -5),
      point(6, -11),
      point(4.5, -11),
    ]),
    trafficBoat('boat_red_runabout', 1.9, 0.4, 0.7, 'steady', [
      point(13.5, -14),
      point(13.5, 0),
      point(13.5, 14),
      point(14.5, 14),
      point(15.5, 14),
      point(15.5, 0),
      point(15.5, -14),
      point(14.5, -14),
    ]),
    trafficBoat('boat_yellow_utility', 1.8, 0.73, 0.68, 'steady', [
      point(0, -2),
      point(2.5, -2),
      point(5, -2),
      point(5, -1),
      point(5, 0),
      point(2.5, 0),
      point(0, 0),
      point(0, -1),
    ]),
  ],
  [
    trafficBoat('boat_red_runabout', 2.05, 0.03, 0.82, 'steady', [
      point(4, -15.3),
      point(6, -15.3),
      point(8, -15.3),
      point(8, -14.3),
      point(8, -13.3),
      point(6, -13.3),
      point(4, -13.3),
      point(4, -14.3),
    ]),
    trafficBoat('boat_teal_skiff', 1.95, 0.28, 0.78, 'steady', [
      point(8, 3),
      point(9, 3),
      point(10, 3),
      point(10, 3.5),
      point(10, 4),
      point(9, 4),
      point(8, 4),
      point(8, 3.5),
    ]),
    trafficBoat('boat_yellow_utility', 1.85, 0.58, 0.74, 'steady', [
      point(-8, 5),
      point(-6.5, 5),
      point(-5, 5),
      point(-5, 5.5),
      point(-5, 6),
      point(-6.5, 6),
      point(-8, 6),
      point(-8, 5.5),
    ]),
    trafficBoat('boat_teal_skiff', 1.75, 0.82, 0.72, 'steady', [
      point(0, -4.5),
      point(1.25, -4.5),
      point(2.5, -4.5),
      point(2.5, -4),
      point(2.5, -3.5),
      point(1.25, -3.5),
      point(0, -3.5),
      point(0, -4),
    ]),
  ],
];

const ENVIRONMENT: Array<{ wind: WindDef; waves: WaveDef }> = [
  { wind: wind(0, 0, 0, 12, 0), waves: wave(0.05, 5.2, point(0, 1), 0) },
  { wind: wind(0.025, 0.01, 0.03, 11, 2), waves: wave(0.08, 4.8, point(0.2, 1), 0) },
  {
    wind: wind(0.04, -0.01, 0.04, 10.5, 3),
    waves: wave(0.12, 4.5, point(0.4, 1), 0.03, [
      crossSwell(0.035, 3.7, point(-1, 0.2)),
    ]),
  },
  {
    wind: wind(0.06, 0, 0.05, 10, 4),
    waves: wave(0.15, 4.2, point(0, 1), 0.05, [
      crossSwell(0.045, 3.5, point(1, 0.2)),
    ]),
  },
  {
    wind: wind(0.08, 0.01, 0.06, 9.5, 5),
    waves: wave(0.18, 4.0, point(0.3, 1), 0.08, [
      crossSwell(0.055, 3.2, point(-1, 0.4)),
    ]),
  },
  {
    wind: wind(0.13, 0, 0.09, 9.2, 6),
    waves: wave(0.23, 3.8, point(1, 0.1), 0.1, [
      crossSwell(0.07, 3.0, point(0.1, 1)),
    ]),
  },
  {
    wind: wind(0.1, 0.03, 0.1, 9, 7),
    waves: wave(0.26, 3.7, point(0.4, 1), 0.12, [
      crossSwell(0.085, 2.9, point(-1, 0.2)),
    ]),
  },
  {
    wind: wind(-0.13, 0.05, 0.11, 8.8, 8),
    waves: wave(0.3, 3.6, point(-0.4, 1), 0.14, [
      crossSwell(0.1, 2.8, point(1, 0.2)),
    ]),
  },
  {
    wind: wind(0.11, 0.12, 0.12, 8.6, 9),
    waves: wave(0.34, 3.5, point(0.7, 0.7), 0.16, [
      crossSwell(0.12, 2.7, point(-0.4, 1)),
    ]),
  },
  {
    wind: wind(0.15, -0.1, 0.14, 8.4, 10),
    waves: wave(0.38, 3.4, point(0.7, -0.7), 0.18, [
      crossSwell(0.14, 2.6, point(1, 0.3)),
    ]),
  },
  {
    wind: wind(0.2, 0.02, 0.16, 8.2, 11),
    waves: wave(0.42, 3.3, point(1, 0.2), 0.2, [
      crossSwell(0.16, 2.5, point(-0.2, 1)),
    ]),
  },
  {
    wind: wind(0.19, 0.11, 0.18, 8, 12),
    waves: wave(0.46, 3.2, point(0.8, 0.4), 0.23, [
      crossSwell(0.18, 2.4, point(-0.7, 0.7)),
    ]),
  },
  {
    wind: wind(0.03, -0.18, 0.18, 7.8, 12),
    waves: wave(0.5, 3.1, point(0, -1), 0.26, [
      crossSwell(0.2, 2.35, point(1, 0.2)),
    ]),
  },
  {
    wind: wind(-0.27, 0.04, 0.23, 7.5, 15),
    waves: wave(0.58, 3.0, point(-1, 0.2), 0.3, [
      crossSwell(0.24, 2.25, point(0.2, 1)),
    ]),
  },
  {
    wind: wind(0.27, -0.13, 0.26, 7.2, 18),
    waves: wave(0.66, 2.9, point(0.65, -0.75), 0.35, [
      crossSwell(0.28, 2.2, point(-0.8, -0.2)),
      crossSwell(0.12, 1.8, point(0.1, 1)),
    ]),
  },
];

const PRECISION: PrecisionTuning[] = [
  { halfWidth: 2.6, yawToleranceDeg: 28, maxHoldSpeed: 1.6, holdSeconds: 1.5 },
  { halfWidth: 2.5, yawToleranceDeg: 27, maxHoldSpeed: 1.5, holdSeconds: 1.6 },
  { halfWidth: 2.45, yawToleranceDeg: 26, maxHoldSpeed: 1.45, holdSeconds: 1.7 },
  { halfWidth: 2.4, yawToleranceDeg: 25, maxHoldSpeed: 1.4, holdSeconds: 1.8 },
  { halfWidth: 2.35, yawToleranceDeg: 24, maxHoldSpeed: 1.35, holdSeconds: 1.9 },
  { halfWidth: 2.3, yawToleranceDeg: 23, maxHoldSpeed: 1.3, holdSeconds: 2.0 },
  { halfWidth: 2.3, yawToleranceDeg: 23, maxHoldSpeed: 1.28, holdSeconds: 2.05 },
  { halfWidth: 2.28, yawToleranceDeg: 22, maxHoldSpeed: 1.25, holdSeconds: 2.1 },
  { halfWidth: 2.25, yawToleranceDeg: 22, maxHoldSpeed: 1.22, holdSeconds: 2.15 },
  { halfWidth: 2.22, yawToleranceDeg: 21, maxHoldSpeed: 1.18, holdSeconds: 2.2 },
  { halfWidth: 2.2, yawToleranceDeg: 20, maxHoldSpeed: 1.15, holdSeconds: 2.3 },
  { halfWidth: 2.18, yawToleranceDeg: 20, maxHoldSpeed: 1.12, holdSeconds: 2.4 },
  { halfWidth: 2.15, yawToleranceDeg: 19, maxHoldSpeed: 1.08, holdSeconds: 2.5 },
  { halfWidth: 2.12, yawToleranceDeg: 18, maxHoldSpeed: 1.04, holdSeconds: 2.65 },
  { halfWidth: 2.08, yawToleranceDeg: 17, maxHoldSpeed: 1.0, holdSeconds: 2.8 },
];

const LESSONS: Partial<Record<number, string>> = {
  2: 'Watch the moving skiff and read its wake before committing.',
  3: 'Cross the wake at a shallow angle, then make the bend.',
  6: 'Read the live wind arrow and counter before each gust peaks.',
};

export function buildProgressiveLevels(layouts: LevelLayout[]): LevelDef[] {
  if (
    layouts.length !== DIFFICULTY.length ||
    layouts.length !== TRAFFIC.length ||
    layouts.length !== ENVIRONMENT.length ||
    layouts.length !== PRECISION.length
  ) {
    throw new Error('Progression tables must match the authored level count.');
  }

  return layouts.map((layout, index) => ({
    ...layout,
    subtitle: LESSONS[index + 1] ?? layout.subtitle,
    difficulty: DIFFICULTY[index]!,
    traffic: TRAFFIC[index]!,
    wind: ENVIRONMENT[index]!.wind,
    waves: ENVIRONMENT[index]!.waves,
    slip: {
      ...layout.slip,
      ...PRECISION[index]!,
    },
  }));
}
