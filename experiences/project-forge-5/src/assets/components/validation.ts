import { ROBOT_COMPONENT_INVENTORY } from './inventory';
import {
  COMPONENT_ROBOT_IDS,
  type ComponentAssetMetadata,
  type ComponentInventoryLike,
  type ComponentRobotId,
} from './types';

export const EXPECTED_COMPONENT_COUNTS = {
  'quadrant-q4': 9,
  'forge-t7': 5,
  'swift-w2': 7,
  'kestrel-d5': 4,
} as const satisfies Readonly<Record<ComponentRobotId, number>>;

export const EXPECTED_COMPONENT_TOTAL = 25;

export type ComponentInventoryIssue = Readonly<{
  code:
    | 'robot-set'
    | 'component-count'
    | 'component-total'
    | 'role-mismatch'
    | 'duplicate-role'
    | 'duplicate-url'
    | 'invalid-url'
    | 'invalid-file-path'
    | 'invalid-byte-size'
    | 'invalid-digest'
    | 'invalid-geometry'
    | 'invalid-bounds';
  location: string;
  message: string;
}>;

const issue = (
  code: ComponentInventoryIssue['code'],
  location: string,
  message: string,
): ComponentInventoryIssue => ({ code, location, message });

const hasPositiveFiniteExtents = (asset: ComponentAssetMetadata): boolean =>
  asset.localBounds.min.every(
    (minimum, axis) =>
      Number.isFinite(minimum) &&
      Number.isFinite(asset.localBounds.max[axis]) &&
      asset.localBounds.max[axis] > minimum,
  );

export const flattenComponentInventory = (
  inventory: ComponentInventoryLike = ROBOT_COMPONENT_INVENTORY,
): readonly ComponentAssetMetadata[] =>
  Object.values(inventory).flatMap((robot) => Object.values(robot));

export const validateComponentInventory = (
  inventory: ComponentInventoryLike = ROBOT_COMPONENT_INVENTORY,
): readonly ComponentInventoryIssue[] => {
  const issues: ComponentInventoryIssue[] = [];
  const actualRobotIds = Object.keys(inventory).sort();
  const expectedRobotIds = [...COMPONENT_ROBOT_IDS].sort();

  if (actualRobotIds.join('|') !== expectedRobotIds.join('|')) {
    issues.push(
      issue(
        'robot-set',
        'inventory',
        `Expected robots ${expectedRobotIds.join(', ')}; received ${actualRobotIds.join(', ')}`,
      ),
    );
  }

  const seenUrls = new Set<string>();
  let total = 0;

  for (const robotId of COMPONENT_ROBOT_IDS) {
    const robot = inventory[robotId];
    if (!robot) continue;

    const entries = Object.entries(robot);
    total += entries.length;
    if (entries.length !== EXPECTED_COMPONENT_COUNTS[robotId]) {
      issues.push(
        issue(
          'component-count',
          robotId,
          `Expected ${EXPECTED_COMPONENT_COUNTS[robotId]} components; received ${entries.length}`,
        ),
      );
    }

    const seenRoles = new Set<string>();
    for (const [role, asset] of entries) {
      const location = `${robotId}/${role}`;

      if (asset.role !== role) {
        issues.push(
          issue('role-mismatch', location, `Map key ${role} does not match role ${asset.role}`),
        );
      }
      if (seenRoles.has(asset.role)) {
        issues.push(issue('duplicate-role', location, `Duplicate semantic role ${asset.role}`));
      }
      seenRoles.add(asset.role);

      if (seenUrls.has(asset.publicUrl)) {
        issues.push(issue('duplicate-url', location, `Duplicate public URL ${asset.publicUrl}`));
      }
      seenUrls.add(asset.publicUrl);

      let publicUrl: URL | null = null;
      try {
        publicUrl = new URL(asset.publicUrl);
      } catch {
        // Report the shared validation error below.
      }
      if (
        !publicUrl ||
        publicUrl.protocol !== 'https:' ||
        publicUrl.hostname !== 'cdn.mint.gg' ||
        !publicUrl.pathname.startsWith('/glb/') ||
        !publicUrl.pathname.endsWith('.glb')
      ) {
        issues.push(issue('invalid-url', location, 'URL must be a Mint CDN GLB'));
      }
      if (
        !asset.filePath.startsWith(`public/models/components/${robotId}/`) ||
        !asset.filePath.endsWith('.glb')
      ) {
        issues.push(
          issue(
            'invalid-file-path',
            location,
            `Expected a diagnostic component path for ${robotId}; received ${asset.filePath}`,
          ),
        );
      }
      if (!Number.isSafeInteger(asset.byteSize) || asset.byteSize <= 0) {
        issues.push(issue('invalid-byte-size', location, `Invalid byte size ${asset.byteSize}`));
      }
      if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
        issues.push(issue('invalid-digest', location, 'SHA-256 must be 64 lowercase hex digits'));
      }

      const { geometry } = asset;
      if (
        ![
          geometry.nodes,
          geometry.meshes,
          geometry.primitives,
          geometry.triangles,
          geometry.materials,
        ].every((count) => Number.isSafeInteger(count) && count > 0) ||
        ![geometry.textures, geometry.images, geometry.skins, geometry.animations].every(
          (count) => Number.isSafeInteger(count) && count >= 0,
        )
      ) {
        issues.push(issue('invalid-geometry', location, 'Geometry counts must be finite integers'));
      }

      if (!hasPositiveFiniteExtents(asset)) {
        issues.push(
          issue(
            'invalid-bounds',
            location,
            'Local bounds must be finite with positive XYZ extents',
          ),
        );
      }
    }
  }

  if (total !== EXPECTED_COMPONENT_TOTAL) {
    issues.push(
      issue(
        'component-total',
        'inventory',
        `Expected ${EXPECTED_COMPONENT_TOTAL} components; received ${total}`,
      ),
    );
  }

  return issues;
};

export const assertValidComponentInventory = (
  inventory: ComponentInventoryLike = ROBOT_COMPONENT_INVENTORY,
): void => {
  const issues = validateComponentInventory(inventory);
  if (issues.length > 0) {
    throw new Error(
      `Invalid robot component inventory:\n${issues
        .map(({ code, location, message }) => `- [${code}] ${location}: ${message}`)
        .join('\n')}`,
    );
  }
};
