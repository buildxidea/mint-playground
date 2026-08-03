import type { RoomId } from '../config/catalog';

export type CommissioningCollider = {
  id: string;
  position: [number, number, number];
  size: [number, number, number];
  rotation?: [number, number, number];
  shape?: 'box' | 'wedge-ramp';
  navigationObstacle: boolean;
  dynamic?: 'vertical-gate';
};

const KINETIC_HALL: readonly CommissioningCollider[] = [
  {
    id: 'ramp-primary',
    position: [-8.2, 0, -4.7],
    size: [2.6, 1.05, 4.6],
    shape: 'wedge-ramp',
    navigationObstacle: false,
  },
  {
    id: 'stairs-short',
    position: [-1.4, 0, -6],
    size: [1.7, 0.8, 2.75],
    shape: 'wedge-ramp',
    navigationObstacle: false,
  },
  {
    id: 'raised-platform',
    position: [2.2, 0.78, -6],
    size: [4.2, 0.18, 3.3],
    navigationObstacle: true,
  },
  {
    id: 'moving-gate',
    position: [9.7, 1.1, -2.5],
    size: [0.18, 2.2, 4.5],
    navigationObstacle: true,
    dynamic: 'vertical-gate',
  },
];

const PRECISION_CELL: readonly CommissioningCollider[] = [
  ...[-6.5, -1.5, 4].map((z): CommissioningCollider => ({
    id: `workbench-${z}`,
    position: [-7.5, 0.43, z],
    size: [3, 0.86, 1.45],
    navigationObstacle: true,
  })),
  {
    id: 'conveyor',
    position: [4, 0.5, -6],
    size: [7, 1, 1.8],
    navigationObstacle: true,
  },
  {
    id: 'storage-shelf',
    position: [11.8, 1.7, -1.5],
    size: [3.75, 3.4, 1.2],
    navigationObstacle: true,
  },
  ...[-1, 1, 3, 5, 7].map((x): CommissioningCollider => ({
    id: `crate-${x}`,
    position: [x, 0.39, 2.4 + (x % 4) * 0.35],
    size: [1.1, 0.75, 0.9],
    navigationObstacle: true,
  })),
];

const CRISIS_BAY: readonly CommissioningCollider[] = [
  {
    id: 'pipe-system',
    position: [-7.8, 2.1, -6],
    size: [7.8, 0.7, 0.8],
    navigationObstacle: true,
  },
  {
    id: 'storage-tank',
    position: [7.5, 1.75, -6.5],
    size: [2.8, 3.5, 2.8],
    navigationObstacle: true,
  },
  {
    id: 'debris-field',
    position: [-1.15, 0.32, -2.4],
    size: [5.4, 0.64, 3.2],
    navigationObstacle: true,
  },
  {
    id: 'elevated-platform',
    position: [4.8, 2.4, 4.6],
    size: [6.5, 0.18, 2.4],
    navigationObstacle: true,
  },
];

export const COMMISSIONING_COLLIDERS: Readonly<Record<RoomId, readonly CommissioningCollider[]>> = {
  'kinetic-hall': KINETIC_HALL,
  'precision-cell': PRECISION_CELL,
  'crisis-bay': CRISIS_BAY,
};

export function createWedgeRampMeshData(size: CommissioningCollider['size']): {
  vertices: Float32Array;
  indices: Uint32Array;
} {
  const [width, height, length] = size;
  const halfWidth = width * 0.5;
  const halfLength = length * 0.5;
  return {
    vertices: new Float32Array([
      -halfWidth,
      0,
      -halfLength,
      halfWidth,
      0,
      -halfLength,
      -halfWidth,
      0,
      halfLength,
      halfWidth,
      0,
      halfLength,
      -halfWidth,
      height,
      -halfLength,
      halfWidth,
      height,
      -halfLength,
    ]),
    indices: new Uint32Array([
      2, 3, 5, 2, 5, 4, 0, 5, 1, 0, 4, 5, 0, 1, 3, 0, 3, 2, 0, 2, 4, 1, 5, 3,
    ]),
  };
}
