export type RobotId = 'axiom-h1' | 'quadrant-q4' | 'forge-t7' | 'swift-w2' | 'kestrel-d5';
export type RoomId = 'kinetic-hall' | 'precision-cell' | 'crisis-bay';
export type ControlMode = 'manual' | 'assisted' | 'autonomous';
export type CameraMode =
  'chase' | 'follow' | 'first-person' | 'sensor' | 'orbit' | 'carry' | 'fixed' | 'overhead';

export type RobotDefinition = {
  id: RobotId;
  name: string;
  designation: string;
  role: string;
  accent: string;
  locomotion: string;
  manipulators: string;
  dimensions: string;
  massClass: string;
  battery: string;
  sensors: readonly string[];
  strengths: readonly string[];
  constraints: readonly string[];
  maxSpeed: number;
  turnRate: number;
};

export type RoomDefinition = {
  id: RoomId;
  name: string;
  code: string;
  purpose: string;
  atmosphere: string;
  recommendedRobots: readonly RobotId[];
};

export type ScenarioObjectiveRule =
  | Readonly<{
      kind: 'route';
      positionTolerance?: number;
    }>
  | Readonly<{
      kind: 'interaction';
      positionTolerance?: number;
    }>
  | Readonly<{
      kind: 'safe-speed';
      maxSpeed: number;
      positionTolerance: number;
    }>
  | Readonly<{
      kind: 'precision-dock';
      positionTolerance: number;
      yawToleranceDegrees: number;
      maxSpeed: number;
      holdSeconds: number;
    }>
  | Readonly<{
      kind: 'physical-interaction';
      targetId: 'control-panel-east';
      positionTolerance: number;
    }>
  | Readonly<{
      kind: 'physical-dock';
      targetId: 'dock-south';
      positionTolerance: number;
      yawToleranceDegrees: number;
      maxSpeed: number;
      holdSeconds: number;
    }>;

export type ScenarioDefinition = {
  id: string;
  robotId: RobotId;
  roomId: RoomId;
  name: string;
  summary: string;
  objectives: readonly string[];
  timeLimitSeconds: number;
  semanticRefs: readonly string[];
  objectiveRules?: readonly ScenarioObjectiveRule[];
};

export const ROBOTS: readonly RobotDefinition[] = [
  {
    id: 'axiom-h1',
    name: 'AXIOM',
    designation: 'H1',
    role: 'Humanoid general-purpose platform',
    accent: '#44a6ff',
    locomotion: 'Bipedal / adaptive step',
    manipulators: 'Dual 7-DoF arms / adaptive hands',
    dimensions: '0.66 × 0.44 × 1.78 m',
    massClass: '82 kg · medium',
    battery: '3.8 h mixed duty',
    sensors: ['Stereo RGB', 'Chest depth', 'Wrist cameras', 'Palm force', 'IMU'],
    strengths: ['Human-space access', 'Tool use', 'Two-hand manipulation'],
    constraints: ['Balance-sensitive', 'Moderate payload', 'Higher energy use'],
    maxSpeed: 3.2,
    turnRate: 2.6,
  },
  {
    id: 'quadrant-q4',
    name: 'QUADRANT',
    designation: 'Q4',
    role: 'Quadruped inspection and mapping platform',
    accent: '#ff8b2b',
    locomotion: 'Four-leg adaptive gait',
    manipulators: 'Payload rack / inspection mast',
    dimensions: '1.10 × 0.48 × 0.72 m',
    massClass: '48 kg · light',
    battery: '4.6 h patrol',
    sensors: ['360° RGB', 'Depth', 'Thermal', 'LiDAR', 'Foot contact', 'IMU'],
    strengths: ['Rough terrain', 'Low passages', 'Rapid reconnaissance'],
    constraints: ['No dexterous grasp', 'Limited payload', 'Footing dependent'],
    maxSpeed: 4.8,
    turnRate: 3.4,
  },
  {
    id: 'forge-t7',
    name: 'FORGE',
    designation: 'T7',
    role: 'Tracked heavy manipulation platform',
    accent: '#ff4d46',
    locomotion: 'Dual-track differential drive',
    manipulators: 'Heavy 6-DoF arm / tool coupler',
    dimensions: '1.92 × 1.24 × 1.58 m',
    massClass: '680 kg · heavy',
    battery: '6.2 h intervention',
    sensors: ['Mast RGB-D', 'Thermal', 'Load cells', 'Track odometry', 'IMU'],
    strengths: ['Heavy lift', 'Debris clearing', 'High traction'],
    constraints: ['Wide turning envelope', 'No stairs', 'Slow acceleration'],
    maxSpeed: 2.2,
    turnRate: 1.35,
  },
  {
    id: 'swift-w2',
    name: 'SWIFT',
    designation: 'W2',
    role: 'Collaborative logistics platform',
    accent: '#48e08c',
    locomotion: 'Omnidirectional wheel base',
    manipulators: 'Dual collaborative arms',
    dimensions: '0.86 × 0.72 × 1.54 m',
    massClass: '126 kg · medium',
    battery: '8.1 h logistics',
    sensors: ['Front/rear depth', 'Safety cameras', 'Wheel odometry', 'Force torque'],
    strengths: ['Precision docking', 'Fast transport', 'Collaborative handling'],
    constraints: ['Smooth floors', 'Low step height', 'Speed-limited near people'],
    maxSpeed: 4.1,
    turnRate: 3.1,
  },
  {
    id: 'kestrel-d5',
    name: 'KESTREL',
    designation: 'D5',
    role: 'Aerial inspection and mapping drone',
    accent: '#b277ff',
    locomotion: 'Six-axis ducted flight',
    manipulators: 'Light payload hook',
    dimensions: '0.78 × 0.78 × 0.34 m',
    massClass: '14 kg · aerial',
    battery: '42 min mission',
    sensors: ['Gimbal RGB', 'Depth', 'Thermal', 'Optical flow', 'Proximity ring', 'IMU'],
    strengths: ['Elevated access', 'Rapid mapping', 'Overhead delivery'],
    constraints: ['Short endurance', 'Airflow sensitive', 'Low payload'],
    maxSpeed: 6.4,
    turnRate: 3.8,
  },
] as const;

/**
 * Conservative horizontal actor envelopes used by route projection and the
 * authoritative Mint World movement clamp. Values include turn clearance so
 * a robot's rendered body cannot rotate outside the RAD/collider bounds.
 */
export const ROBOT_WORLD_MARGIN: Readonly<Record<RobotId, number>> = {
  'axiom-h1': 0.65,
  'quadrant-q4': 0.75,
  'forge-t7': 1.2,
  'swift-w2': 0.75,
  'kestrel-d5': 0.6,
};

/** Authoritative rendered and physical envelopes in meters: width × height × depth. */
export const ROBOT_DIMENSIONS_METERS: Readonly<Record<RobotId, readonly [number, number, number]>> =
  Object.freeze({
    'axiom-h1': [0.66, 1.78, 0.44],
    'quadrant-q4': [0.48, 0.72, 1.1],
    'forge-t7': [1.24, 1.58, 1.92],
    'swift-w2': [0.86, 1.54, 0.72],
    'kestrel-d5': [0.78, 0.34, 0.78],
  });

export const ROOMS: readonly RoomDefinition[] = [
  {
    id: 'kinetic-hall',
    name: 'KINETIC HALL',
    code: 'KH-01',
    purpose: 'Mobility · navigation · balance · perception',
    atmosphere: 'Reinforced test hall with configurable traversal lanes',
    recommendedRobots: ['axiom-h1', 'quadrant-q4', 'swift-w2', 'kestrel-d5', 'forge-t7'],
  },
  {
    id: 'precision-cell',
    name: 'PRECISION CELL',
    code: 'PC-02',
    purpose: 'Manipulation · assembly · logistics',
    atmosphere: 'Instrumented industrial manipulation laboratory',
    recommendedRobots: ['swift-w2', 'axiom-h1', 'forge-t7', 'quadrant-q4', 'kestrel-d5'],
  },
  {
    id: 'crisis-bay',
    name: 'CRISIS BAY',
    code: 'CB-03',
    purpose: 'Emergency response · search · coordination',
    atmosphere: 'Reconfigurable industrial incident chamber',
    recommendedRobots: ['forge-t7', 'quadrant-q4', 'kestrel-d5', 'axiom-h1', 'swift-w2'],
  },
] as const;

const scenario = (
  robotId: RobotId,
  roomId: RoomId,
  name: string,
  summary: string,
  objectives: readonly string[],
  semanticRefs: readonly string[],
  timeLimitSeconds = 180,
  objectiveRules?: readonly ScenarioObjectiveRule[],
): ScenarioDefinition => ({
  id: `${robotId}--${roomId}`,
  robotId,
  roomId,
  name,
  summary,
  objectives,
  timeLimitSeconds,
  semanticRefs,
  objectiveRules,
});

export const SCENARIOS: readonly ScenarioDefinition[] = [
  scenario(
    'axiom-h1',
    'kinetic-hall',
    'Human-Space Qualification',
    'Traverse the mixed-height course, operate access controls, and dock.',
    [
      'Clear ramp gate',
      'Traverse stair or bypass',
      'Confirm control panel',
      'Dock within tolerance',
    ],
    ['ramp-primary', 'stairs-short', 'door-east', 'control-panel-east', 'dock-h1'],
    180,
    [
      { kind: 'route', positionTolerance: 0.7 },
      { kind: 'route', positionTolerance: 0.12 },
      {
        kind: 'physical-interaction',
        targetId: 'control-panel-east',
        positionTolerance: 0.55,
      },
      {
        kind: 'physical-dock',
        targetId: 'dock-south',
        positionTolerance: 0.12,
        yawToleranceDegrees: 5,
        maxSpeed: 0.05,
        holdSeconds: 1.5,
      },
    ],
  ),
  scenario(
    'quadrant-q4',
    'kinetic-hall',
    'Adaptive Terrain Recon',
    'Map obstacles through the low lane and return to charge.',
    ['Scan markers', 'Cross rubble step', 'Pass low frame', 'Dock'],
    ['low-passage', 'barrier-field', 'calibration-marker', 'dock-q4'],
    150,
  ),
  scenario(
    'forge-t7',
    'kinetic-hall',
    'Traction and Push Trial',
    'Push the heavy barrier clear without entering the protected zone.',
    ['Reach obstruction', 'Stabilize', 'Clear barrier', 'Return to bay'],
    ['heavy-barrier', 'safety-fence', 'deployment-bay-t7'],
    210,
  ),
  scenario(
    'swift-w2',
    'kinetic-hall',
    'Precision Transit',
    'Complete a fast, low-collision route through moving gates.',
    ['Slalom', 'Avoid gate', 'Hold safe speed', 'Precision dock'],
    ['slalom-cones', 'moving-gate', 'dock-w2'],
    125,
    [
      { kind: 'route', positionTolerance: 0.55 },
      { kind: 'route', positionTolerance: 0.7 },
      { kind: 'safe-speed', maxSpeed: 1, positionTolerance: 0.55 },
      {
        kind: 'precision-dock',
        positionTolerance: 0.12,
        yawToleranceDegrees: 5,
        maxSpeed: 0.05,
        holdSeconds: 1.5,
      },
    ],
  ),
  scenario(
    'kestrel-d5',
    'kinetic-hall',
    'Aerial Fiducial Sweep',
    'Scan elevated markers and land on the inspection pad.',
    ['Take off', 'Scan upper markers', 'Clear overhead frame', 'Precision land'],
    ['overhead-camera', 'fiducial-wall', 'landing-pad'],
    120,
  ),
  scenario(
    'axiom-h1',
    'precision-cell',
    'Two-Hand Assembly',
    'Collect a tool and seat a component in the calibrated fixture.',
    ['Select tool', 'Two-hand grasp', 'Insert component', 'Verify tolerance'],
    ['tool-rack', 'workbench', 'assembly-fixture'],
    240,
  ),
  scenario(
    'quadrant-q4',
    'precision-cell',
    'Inventory Route',
    'Inspect storage labels and deliver a light payload.',
    ['Scan shelves', 'Locate discrepancy', 'Collect payload', 'Deliver to station'],
    ['shelving-unit', 'barcode-station', 'machine-vision-camera'],
    170,
  ),
  scenario(
    'forge-t7',
    'precision-cell',
    'Fixture Exchange',
    'Move a heavy pallet and rotate the fixture into service position.',
    ['Approach pallet', 'Lift fixture', 'Move to anchor', 'Set down safely'],
    ['pallet', 'floor-anchor', 'tool-changer'],
    260,
  ),
  scenario(
    'swift-w2',
    'precision-cell',
    'Flowline Sort',
    'Sort bins from the conveyor and complete a handoff.',
    ['Scan labels', 'Sort three bins', 'Load conveyor', 'Robot handoff'],
    ['conveyor-belt', 'parts-bin', 'safety-mat'],
    180,
  ),
  scenario(
    'kestrel-d5',
    'precision-cell',
    'High-Bay Inventory',
    'Scan upper shelves and deliver a lightweight package.',
    ['Launch', 'Scan high shelf', 'Pick payload', 'Release at station'],
    ['shelf-high', 'package', 'delivery-pad'],
    145,
  ),
  scenario(
    'axiom-h1',
    'crisis-bay',
    'Rescue Access',
    'Open a blocked access route, retrieve the kit, and assist the mannequin.',
    ['Operate fire door', 'Retrieve kit', 'Close valve', 'Reach mannequin'],
    ['fire-door', 'rescue-kit', 'valve-primary', 'rescue-mannequin'],
    300,
  ),
  scenario(
    'quadrant-q4',
    'crisis-bay',
    'Thermal Recon',
    'Locate heat and leak sources, then report a safe route.',
    ['Map debris', 'Find heat source', 'Find leak', 'Return route'],
    ['debris-field', 'thermal-target', 'leaking-tank'],
    200,
  ),
  scenario(
    'forge-t7',
    'crisis-bay',
    'Route Recovery',
    'Clear structural debris and recover a disabled platform.',
    ['Stabilize', 'Clear debris', 'Attach recovery line', 'Tow to bay'],
    ['blocked-doorway', 'debris-heavy', 'deployment-bay'],
    330,
  ),
  scenario(
    'swift-w2',
    'crisis-bay',
    'Emergency Supply Run',
    'Deliver equipment and execute the cabinet isolation sequence.',
    ['Collect supply tote', 'Navigate safe route', 'Panel sequence', 'Deliver equipment'],
    ['supply-tote', 'control-cabinet', 'safe-corridor'],
    210,
  ),
  scenario(
    'kestrel-d5',
    'crisis-bay',
    'Overhead Incident Map',
    'Inspect the catwalk, localize the leak, and relay a map.',
    ['Take off', 'Inspect catwalk', 'Thermal scan', 'Transmit map'],
    ['catwalk', 'gas-cylinder', 'leaking-tank'],
    165,
  ),
] as const;

export function getRobot(id: RobotId): RobotDefinition {
  const robot = ROBOTS.find((candidate) => candidate.id === id);
  if (!robot) throw new Error(`Unknown robot: ${id}`);
  return robot;
}

export function getRoom(id: RoomId): RoomDefinition {
  const room = ROOMS.find((candidate) => candidate.id === id);
  if (!room) throw new Error(`Unknown room: ${id}`);
  return room;
}

export function getScenario(robotId: RobotId, roomId: RoomId): ScenarioDefinition {
  const found = SCENARIOS.find(
    (candidate) => candidate.robotId === robotId && candidate.roomId === roomId,
  );
  if (!found) throw new Error(`Missing scenario for ${robotId} in ${roomId}`);
  return found;
}
