export {
  COMPONENT_ASSETS,
  ROBOT_COMPONENT_INVENTORY,
  type ForgeT7ComponentRole,
  type KestrelD5ComponentRole,
  type QuadrantQ4ComponentRole,
  type RobotComponentInventory,
  type RobotComponentRole,
  type SwiftW2ComponentRole,
} from './inventory';
export {
  EXPECTED_COMPONENT_COUNTS,
  EXPECTED_COMPONENT_TOTAL,
  assertValidComponentInventory,
  flattenComponentInventory,
  validateComponentInventory,
  type ComponentInventoryIssue,
} from './validation';
export {
  COMPONENT_ROBOT_IDS,
  type ComponentAssetMetadata,
  type ComponentGeometryStats,
  type ComponentInventoryLike,
  type ComponentRobotId,
  type LocalBounds,
  type Vector3Tuple,
} from './types';
