import { KINETIC_HALL_PROP_PLACEMENTS, parseKineticHallPropPlacements } from './placements';
import type { KineticHallPropPlacement } from './types';

const RUNTIME_POSITION_OVERRIDES: Readonly<
  Partial<
    Record<
      KineticHallPropPlacement['instanceId'],
      KineticHallPropPlacement['resetPose']['position']
    >
  >
> = Object.freeze({
  'sled-primary': [0, 0.393, 9.2],
  'slalom-cone-1': [-0.78, 0.324, 5.4],
  'slalom-cone-2': [0.78, 0.324, 6.2],
  'slalom-cone-3': [-0.78, 0.324, 7],
  'slalom-cone-4': [0.78, 0.324, 7.8],
  'clearance-gantry': [0, 1.336, -4.2],
});

const RUNTIME_SCALE_OVERRIDES: Readonly<
  Partial<
    Record<KineticHallPropPlacement['instanceId'], KineticHallPropPlacement['resetPose']['scale']>
  >
> = Object.freeze({
  // The authored 2.8× Y scale exceeded the final collider/splat envelope by
  // roughly 7 cm. This keeps the complete gantry geometry below the ceiling.
  'clearance-gantry': [3, 2.72, 1.3],
});

/**
 * Runtime additions and relocations are isolated from the immutable reviewed
 * placement module so its accepted dock provenance remains byte-identical.
 */
export const KINETIC_HALL_RUNTIME_PROP_PLACEMENTS = parseKineticHallPropPlacements([
  ...KINETIC_HALL_PROP_PLACEMENTS.map((placement): KineticHallPropPlacement => {
    const position = RUNTIME_POSITION_OVERRIDES[placement.instanceId];
    const scale = RUNTIME_SCALE_OVERRIDES[placement.instanceId];
    if (!position && !scale) return placement;
    return {
      ...placement,
      resetPose: {
        ...placement.resetPose,
        position: position ?? placement.resetPose.position,
        scale: scale ?? placement.resetPose.scale,
      },
    };
  }),
  {
    instanceId: 'ramp-primary',
    assetId: 'traversable-training-ramp',
    resetPose: {
      position: [1.2, 0.6250419079487036, 0.5],
      quaternion: [0, 0, 0, 1],
      scale: [7.345767575322813, 3.468878744840851, 5.486907091603763],
    },
  },
]);
