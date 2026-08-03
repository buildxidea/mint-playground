import type { RobotId } from '../config/catalog';

export type RobotControlHint = Readonly<{
  keys: string;
  label: string;
}>;

const STANDARD_CONTROLS: readonly RobotControlHint[] = [
  { keys: 'W / S', label: 'DRIVE' },
  { keys: 'A / D', label: 'STEER' },
  { keys: 'ALT', label: 'PRECISION' },
  { keys: 'E', label: 'PRIMARY' },
  { keys: 'Q', label: 'RELEASE / CANCEL' },
  { keys: 'C', label: 'VIEWS' },
  { keys: 'X', label: 'E-STOP' },
];

const AXIOM_CONTROLS: readonly RobotControlHint[] = [
  ...STANDARD_CONTROLS.slice(0, 5),
  { keys: 'Z', label: 'POSTURE' },
  ...STANDARD_CONTROLS.slice(5),
];

const SWIFT_CONTROLS: readonly RobotControlHint[] = [
  { keys: 'W A S D', label: 'MOVE / STRAFE' },
  { keys: '← / →', label: 'YAW' },
  { keys: 'ALT', label: 'PRECISION' },
  { keys: 'E', label: 'PRIMARY' },
  { keys: 'Q', label: 'RELEASE / CANCEL' },
  { keys: 'C', label: 'VIEWS' },
  { keys: 'X', label: 'E-STOP' },
];

const DRONE_CONTROLS: readonly RobotControlHint[] = [
  { keys: 'W A S D', label: 'HORIZONTAL' },
  { keys: '← / →', label: 'YAW' },
  { keys: 'SPACE / CTRL', label: 'UP / DOWN' },
  { keys: 'ALT', label: 'PRECISION' },
  { keys: 'E', label: 'SCAN / USE' },
  { keys: 'Q', label: 'RELEASE / CANCEL' },
  { keys: 'C', label: 'VIEWS' },
  { keys: 'X', label: 'E-STOP' },
];

export function getRobotControlHints(robotId: RobotId): readonly RobotControlHint[] {
  if (robotId === 'kestrel-d5') return DRONE_CONTROLS;
  if (robotId === 'swift-w2') return SWIFT_CONTROLS;
  if (robotId === 'axiom-h1') return AXIOM_CONTROLS;
  return STANDARD_CONTROLS;
}
