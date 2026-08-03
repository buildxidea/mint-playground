import * as THREE from 'three';
import type { RobotId } from '../config/catalog';

export type RobotAssemblyContract = Readonly<{
  /** Rotation from the imported assembly's authored heading to world forward (-Z). */
  importedHeadingYawRadians: number;
  neutralPose: string;
  calibrationAxis: 'width' | 'height' | 'depth';
}>;

const ASSEMBLY_CONTRACTS: Readonly<Record<RobotId, RobotAssemblyContract>> = Object.freeze({
  'axiom-h1': {
    importedHeadingYawRadians: 0,
    neutralPose: 'idle-animation-frame-zero',
    calibrationAxis: 'height',
  },
  'quadrant-q4': {
    importedHeadingYawRadians: -Math.PI / 2,
    neutralPose: 'standing-gait',
    calibrationAxis: 'height',
  },
  'forge-t7': {
    importedHeadingYawRadians: -Math.PI / 2,
    neutralPose: 'transport-arm',
    calibrationAxis: 'height',
  },
  'swift-w2': {
    importedHeadingYawRadians: 0,
    neutralPose: 'mast-and-arms-idle',
    calibrationAxis: 'height',
  },
  'kestrel-d5': {
    importedHeadingYawRadians: 0,
    neutralPose: 'level-hover',
    calibrationAxis: 'width',
  },
});

export function getRobotAssemblyContract(robotId: RobotId): RobotAssemblyContract {
  return ASSEMBLY_CONTRACTS[robotId];
}

export function alignImportedRobotHeading(body: THREE.Object3D, robotId: RobotId): void {
  const contract = getRobotAssemblyContract(robotId);
  body.rotation.y = contract.importedHeadingYawRadians;
  body.userData.importedHeadingYawRadians = contract.importedHeadingYawRadians;
  body.userData.canonicalForward = '-Z';
}
