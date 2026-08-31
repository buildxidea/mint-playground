import * as THREE from 'three';
import type { LevelDefinition } from './types';

export const NHL_CORNER_RADIUS_TO_WIDTH = 28 / 85;

export type RinkPoint = { x: number; z: number };

export type RoundedRinkContact = {
  signedDistance: number;
  outwardX: number;
  outwardZ: number;
};

const clampedRadius = (halfWidth: number, halfDepth: number, radius: number): number =>
  Math.max(0, Math.min(radius, halfWidth, halfDepth));

export function roundedRinkContact(
  x: number,
  z: number,
  halfWidth: number,
  halfDepth: number,
  cornerRadius: number,
): RoundedRinkContact {
  const radius = clampedRadius(halfWidth, halfDepth, cornerRadius);
  const coreX = halfWidth - radius;
  const coreZ = halfDepth - radius;
  const qx = Math.abs(x) - coreX;
  const qz = Math.abs(z) - coreZ;
  const outsideX = Math.max(qx, 0);
  const outsideZ = Math.max(qz, 0);
  const outsideLength = Math.hypot(outsideX, outsideZ);
  const signedDistance = outsideLength + Math.min(Math.max(qx, qz), 0) - radius;

  if (outsideLength > 1e-7) {
    return {
      signedDistance,
      outwardX: (outsideX / outsideLength) * (x < 0 ? -1 : 1),
      outwardZ: (outsideZ / outsideLength) * (z < 0 ? -1 : 1),
    };
  }

  if (qx > qz) {
    return { signedDistance, outwardX: x < 0 ? -1 : 1, outwardZ: 0 };
  }
  return { signedDistance, outwardX: 0, outwardZ: z < 0 ? -1 : 1 };
}

export function isInsideRoundedRink(
  x: number,
  z: number,
  level: Pick<LevelDefinition, 'halfWidth' | 'halfDepth' | 'cornerRadius'>,
  clearance = 0,
): boolean {
  return roundedRinkContact(x, z, level.halfWidth, level.halfDepth, level.cornerRadius).signedDistance <= -clearance;
}

export function roundedRinkArea(
  level: Pick<LevelDefinition, 'halfWidth' | 'halfDepth' | 'cornerRadius'>,
): number {
  const radius = clampedRadius(level.halfWidth, level.halfDepth, level.cornerRadius);
  return level.halfWidth * 2 * level.halfDepth * 2 - (4 - Math.PI) * radius * radius;
}

function roundedRectanglePoints(halfWidth: number, halfDepth: number, cornerRadius: number, segments = 14): THREE.Vector2[] {
  const radius = clampedRadius(halfWidth, halfDepth, cornerRadius);
  const centers: Array<[number, number, number]> = [
    [halfWidth - radius, -halfDepth + radius, -Math.PI / 2],
    [halfWidth - radius, halfDepth - radius, 0],
    [-halfWidth + radius, halfDepth - radius, Math.PI / 2],
    [-halfWidth + radius, -halfDepth + radius, Math.PI],
  ];
  const points: THREE.Vector2[] = [];
  for (const [centerX, centerY, startAngle] of centers) {
    for (let step = 0; step <= segments; step += 1) {
      const angle = startAngle + (step / segments) * Math.PI / 2;
      points.push(new THREE.Vector2(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius));
    }
  }
  return points;
}

export function createRoundedRinkSurfaceGeometry(
  level: Pick<LevelDefinition, 'halfWidth' | 'halfDepth' | 'cornerRadius'>,
  inset = 0,
): THREE.ShapeGeometry {
  const halfWidth = Math.max(0.01, level.halfWidth - inset);
  const halfDepth = Math.max(0.01, level.halfDepth - inset);
  const radius = Math.max(0.01, level.cornerRadius - inset);
  const geometry = new THREE.ShapeGeometry(new THREE.Shape(roundedRectanglePoints(halfWidth, halfDepth, radius)), 14);
  const positions = geometry.getAttribute('position');
  const uvs = new Float32Array(positions.count * 2);
  for (let index = 0; index < positions.count; index += 1) {
    uvs[index * 2] = (positions.getX(index) + level.halfWidth) / (level.halfWidth * 2);
    uvs[index * 2 + 1] = (positions.getY(index) + level.halfDepth) / (level.halfDepth * 2);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

export function createRoundedRinkBandGeometry(
  level: Pick<LevelDefinition, 'halfWidth' | 'halfDepth' | 'cornerRadius'>,
  offset: number,
  thickness: number,
  height: number,
): THREE.ExtrudeGeometry {
  const innerHalfWidth = level.halfWidth + offset;
  const innerHalfDepth = level.halfDepth + offset;
  const innerRadius = level.cornerRadius + offset;
  const outerPoints = roundedRectanglePoints(
    innerHalfWidth + thickness,
    innerHalfDepth + thickness,
    innerRadius + thickness,
  );
  const innerPoints = roundedRectanglePoints(innerHalfWidth, innerHalfDepth, innerRadius).reverse();
  const shape = new THREE.Shape(outerPoints);
  shape.holes.push(new THREE.Path(innerPoints));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 14,
    steps: 1,
  });
  geometry.computeVertexNormals();
  return geometry;
}

export function sampleRoundedRinkPerimeter(
  level: Pick<LevelDefinition, 'halfWidth' | 'halfDepth' | 'cornerRadius'>,
  spacing: number,
  offset = 0,
): RinkPoint[] {
  const dense = roundedRectanglePoints(
    level.halfWidth + offset,
    level.halfDepth + offset,
    level.cornerRadius + offset,
    32,
  );
  const cumulative = [0];
  for (let index = 1; index <= dense.length; index += 1) {
    cumulative.push(cumulative[index - 1] + dense[index % dense.length].distanceTo(dense[index - 1]));
  }
  const perimeter = cumulative[cumulative.length - 1];
  const count = Math.max(4, Math.round(perimeter / spacing));
  const samples: RinkPoint[] = [];
  let segment = 1;
  for (let sample = 0; sample < count; sample += 1) {
    const target = (sample / count) * perimeter;
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
    const start = dense[segment - 1];
    const end = dense[segment % dense.length];
    const segmentLength = cumulative[segment] - cumulative[segment - 1];
    const t = segmentLength > 0 ? (target - cumulative[segment - 1]) / segmentLength : 0;
    const x = THREE.MathUtils.lerp(start.x, end.x, t);
    const shapeY = THREE.MathUtils.lerp(start.y, end.y, t);
    samples.push({ x, z: -shapeY });
  }
  return samples;
}
