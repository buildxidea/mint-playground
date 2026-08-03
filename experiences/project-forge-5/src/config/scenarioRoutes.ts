import * as THREE from 'three';
import type { RobotId, RoomId } from './catalog';

type Point = readonly [number, number, number];
type RoomRoutes = Readonly<Record<RobotId, readonly Point[]>>;

const START: Point = [-13.5, 0, 7.5];

const ROUTES: Readonly<Record<RoomId, RoomRoutes>> = {
  'kinetic-hall': {
    'axiom-h1': [START, [-8.2, 0, -4.7], [-1.4, 0, -5.7], [13.1, 0, -5.6], [13.2, 0, 7.2]],
    'quadrant-q4': [START, [-10, 0, 3], [-5, 0, -2], [6.5, 0, 4.8], [13.2, 0, 7.2]],
    'forge-t7': [START, [-7.2, 0, 1.8], [-5.4, 0, -1.5], [5.8, 0, 1.2], [12.8, 0, 7.6]],
    'swift-w2': [START, [1.4, 0, 4.8], [4.1, 0, 1.2], [8.5, 0, -2.5], [13.2, 0, 7.2]],
    'kestrel-d5': [START, [-7, 3.2, 4], [0, 4.2, -2], [9.4, 2.4, -2.5], [13.2, 1.8, 7.2]],
  },
  'precision-cell': {
    'axiom-h1': [START, [-5.4, 0, -6.5], [-5.4, 0, -1.5], [8.8, 0, -4.6], [13, 0, 6.5]],
    'quadrant-q4': [START, [-10.2, 0, -4], [-9.8, 0, 4], [1.5, 0, 4.8], [12.8, 0, 6.5]],
    'forge-t7': [START, [-7, 0, 5.2], [-1.5, 0, 5.5], [6.2, 0, 4.6], [12.5, 0, 6.2]],
    'swift-w2': [START, [0, 0, -4.3], [7.8, 0, -4.2], [7, 0, 2.8], [13, 0, 6.5]],
    'kestrel-d5': [START, [-8.8, 3.1, -1.5], [10.4, 3.6, -1.5], [2, 2.4, 3], [13, 1.8, 6.5]],
  },
  'crisis-bay': {
    'axiom-h1': [START, [-10, 0, 3], [-5.2, 0, 1.5], [-5.4, 0, -5], [10.5, 0, 1.2]],
    'quadrant-q4': [START, [-5.4, 0, -1], [2, 0, -1], [5.2, 0, -5], [12.8, 0, 7.2]],
    'forge-t7': [START, [-6.4, 0, 2.5], [-4.7, 0, -0.2], [5.5, 0, 1.5], [12.2, 0, 7]],
    'swift-w2': [START, [-9.5, 0, 4], [0.5, 0, 2.5], [12.8, 0, 5.8], [10.5, 0, 1.2]],
    'kestrel-d5': [START, [4.8, 4, 4.6], [7.5, 3.8, -6.5], [-7, 3.4, -5.5], [12.8, 1.8, 7.2]],
  },
};

export function getScenarioRoute(roomId: RoomId, robotId: RobotId): readonly THREE.Vector3[] {
  return ROUTES[roomId][robotId].map(([x, y, z]) => new THREE.Vector3(x, y, z));
}

export function getScenarioRouteKey(roomId: RoomId, robotId: RobotId): string {
  return ROUTES[roomId][robotId].map((point) => point.join(',')).join('|');
}

export function getScenarioNavigationApproach(
  roomId: RoomId,
  robotId: RobotId,
  objectiveIndex: number,
): THREE.Vector3 | null {
  if (roomId === 'kinetic-hall' && robotId === 'axiom-h1' && objectiveIndex === 2) {
    return new THREE.Vector3(-1.4, 0, -4.15);
  }
  return null;
}
