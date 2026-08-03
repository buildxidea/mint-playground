import type { RoomId } from '../../config/catalog';
import { KINETIC_HALL_PROP_DEFINITION } from './inventory';
import { parseMintPropPlacements } from './placements';
import { CRISIS_BAY_PROP_DEFINITION, PRECISION_CELL_PROP_DEFINITION } from './roomInventories';
import { KINETIC_HALL_RUNTIME_PROP_PLACEMENTS } from './runtimePlacements';
import type { MintPropPackDefinition, MintPropPlacement } from './types';

export const PRECISION_CELL_PROP_PLACEMENTS = parseMintPropPlacements(
  [
    {
      instanceId: 'parts-bin-west',
      assetId: 'stackable-parts-bin',
      resetPose: {
        position: [-3.55, 0.21, -10],
        quaternion: [0, 0, 0, 1],
        scale: [0.8, 0.8, 0.8],
      },
    },
    {
      instanceId: 'transport-tote-east',
      assetId: 'collaborative-transport-tote',
      resetPose: {
        position: [3.5, 0.394, -10],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    },
    {
      instanceId: 'insertion-component-west',
      assetId: 'calibrated-insertion-component',
      resetPose: {
        position: [-3.55, 0.175, -5.2],
        quaternion: [0, 0, 0.7071067811865476, 0.7071067811865476],
        scale: [0.35, 0.35, 0.35],
      },
    },
    {
      instanceId: 'assembly-fixture-east',
      assetId: 'instrumented-assembly-fixture',
      resetPose: {
        position: [3.5, 0.402, -5.2],
        quaternion: [0, -0.7071067811865476, 0, 0.7071067811865476],
        scale: [0.9, 0.9, 0.9],
      },
    },
    {
      instanceId: 'heavy-fixture-west',
      assetId: 'heavy-exchange-fixture',
      resetPose: {
        position: [-3.35, 0.305, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1.6, 1.6, 1.6],
      },
    },
    {
      instanceId: 'delivery-parcel-east',
      assetId: 'barcode-delivery-parcel',
      resetPose: {
        position: [3.55, 0.225, 0],
        quaternion: [0, 0.7071067811865476, 0, 0.7071067811865476],
        scale: [0.45, 0.45, 0.45],
      },
    },
    {
      instanceId: 'optical-module-west',
      assetId: 'optical-inspection-module',
      resetPose: {
        position: [-3.55, 0.275, 5.2],
        quaternion: [0, 0, 0, 1],
        scale: [0.55, 0.55, 0.55],
      },
    },
    {
      instanceId: 'torque-driver-east',
      assetId: 'electric-torque-driver',
      resetPose: {
        position: [3.55, 0.246, 5.2],
        quaternion: [0, 0.7071067811865476, 0, 0.7071067811865476],
        scale: [0.65, 0.65, 0.65],
      },
    },
  ],
  PRECISION_CELL_PROP_DEFINITION.byId,
  'Precision Cell',
);

export const CRISIS_BAY_PROP_PLACEMENTS = parseMintPropPlacements(
  [
    {
      instanceId: 'valve-trainer-west',
      assetId: 'shutoff-valve-trainer',
      resetPose: {
        position: [-1.95, 0.554, -5.5],
        quaternion: [0, 0.7071067811865476, 0, 0.7071067811865476],
        scale: [1.2, 1.2, 1.2],
      },
    },
    {
      instanceId: 'rescue-mannequin-east',
      assetId: 'rescue-mannequin',
      resetPose: {
        position: [1.95, 0.234, -5.5],
        quaternion: [0, 0, 0, 1],
        scale: [1.8, 1.8, 1.8],
      },
    },
    {
      instanceId: 'rescue-case-west',
      assetId: 'rescue-equipment-case',
      resetPose: {
        position: [-2, 0.27, -2.7],
        quaternion: [0, 0, 0, 1],
        scale: [0.9, 0.9, 0.9],
      },
    },
    {
      instanceId: 'supply-tote-east',
      assetId: 'emergency-supply-tote',
      resetPose: {
        position: [2, 0.301, -2.7],
        quaternion: [0, 0, 0, 1],
        scale: [0.9, 0.9, 0.9],
      },
    },
    {
      instanceId: 'debris-block-west',
      assetId: 'structural-debris-block',
      resetPose: {
        position: [-1.95, 0.599, 0.5],
        quaternion: [0, 0.7071067811865476, 0, 0.7071067811865476],
        scale: [1.2, 1.2, 1.2],
      },
    },
    {
      instanceId: 'recovery-bogie-east',
      assetId: 'recovery-bogie',
      resetPose: {
        position: [1.95, 0.247, 0.5],
        quaternion: [0, 0, 0, 1],
        scale: [1.2, 1.2, 1.2],
      },
    },
    {
      instanceId: 'leak-cylinder-west',
      assetId: 'leak-localization-cylinder',
      resetPose: {
        position: [-2, 0.649, 3.5],
        quaternion: [0, 0, 0, 1],
        scale: [1.3, 1.3, 1.3],
      },
    },
    {
      instanceId: 'isolation-cabinet-east',
      assetId: 'isolation-control-cabinet',
      resetPose: {
        position: [1.95, 0.599, 3.5],
        quaternion: [0, -0.7071067811865476, 0, 0.7071067811865476],
        scale: [1.2, 1.2, 1.2],
      },
    },
  ],
  CRISIS_BAY_PROP_DEFINITION.byId,
  'Crisis Bay',
);

export const FORGE_PROP_PACK_BY_ROOM: Readonly<Record<RoomId, MintPropPackDefinition>> =
  Object.freeze({
    'kinetic-hall': KINETIC_HALL_PROP_DEFINITION,
    'precision-cell': PRECISION_CELL_PROP_DEFINITION,
    'crisis-bay': CRISIS_BAY_PROP_DEFINITION,
  });

export const FORGE_PROP_PLACEMENTS_BY_ROOM: Readonly<Record<RoomId, readonly MintPropPlacement[]>> =
  Object.freeze({
    'kinetic-hall': KINETIC_HALL_RUNTIME_PROP_PLACEMENTS,
    'precision-cell': PRECISION_CELL_PROP_PLACEMENTS,
    'crisis-bay': CRISIS_BAY_PROP_PLACEMENTS,
  });
