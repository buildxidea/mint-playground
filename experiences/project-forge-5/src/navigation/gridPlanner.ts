export type Point2 = { x: number; z: number };
export type Aabb2 = { minX: number; maxX: number; minZ: number; maxZ: number };
export type GridPlanRequest = {
  start: Point2;
  goal: Point2;
  bounds: Aabb2;
  obstacles: readonly Aabb2[];
  cellSize: number;
  clearance: number;
};

type NodeRecord = {
  key: string;
  x: number;
  z: number;
  g: number;
  f: number;
};

const keyOf = (x: number, z: number) => `${x},${z}`;
const heuristic = (x: number, z: number, goalX: number, goalZ: number) =>
  Math.hypot(goalX - x, goalZ - z);

export function planGridPath(request: GridPlanRequest): Point2[] {
  const width = Math.floor((request.bounds.maxX - request.bounds.minX) / request.cellSize) + 1;
  const depth = Math.floor((request.bounds.maxZ - request.bounds.minZ) / request.cellSize) + 1;
  const toGrid = (point: Point2) => ({
    x: Math.round((point.x - request.bounds.minX) / request.cellSize),
    z: Math.round((point.z - request.bounds.minZ) / request.cellSize),
  });
  const toWorld = (x: number, z: number): Point2 => ({
    x: request.bounds.minX + x * request.cellSize,
    z: request.bounds.minZ + z * request.cellSize,
  });
  const start = toGrid(request.start);
  const goal = toGrid(request.goal);
  const isBlocked = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= width || z >= depth) return true;
    const world = toWorld(x, z);
    return request.obstacles.some(
      (obstacle) =>
        world.x >= obstacle.minX - request.clearance &&
        world.x <= obstacle.maxX + request.clearance &&
        world.z >= obstacle.minZ - request.clearance &&
        world.z <= obstacle.maxZ + request.clearance,
    );
  };

  if (isBlocked(start.x, start.z) || isBlocked(goal.x, goal.z)) return [];

  const open = new Map<string, NodeRecord>();
  const closed = new Set<string>();
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();
  const startKey = keyOf(start.x, start.z);
  open.set(startKey, {
    key: startKey,
    x: start.x,
    z: start.z,
    g: 0,
    f: heuristic(start.x, start.z, goal.x, goal.z),
  });
  gScore.set(startKey, 0);

  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const;

  while (open.size > 0) {
    let current: NodeRecord | null = null;
    for (const node of open.values()) {
      if (!current || node.f < current.f || (node.f === current.f && node.key < current.key)) {
        current = node;
      }
    }
    if (!current) break;
    open.delete(current.key);
    if (current.x === goal.x && current.z === goal.z) {
      const path: Point2[] = [toWorld(current.x, current.z)];
      let cursor = current.key;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor)!;
        const [x, z] = cursor.split(',').map(Number);
        path.push(toWorld(x, z));
      }
      path.reverse();
      return simplifyPath(path);
    }

    closed.add(current.key);
    for (const [dx, dz] of neighbors) {
      const nextX = current.x + dx;
      const nextZ = current.z + dz;
      const nextKey = keyOf(nextX, nextZ);
      if (closed.has(nextKey) || isBlocked(nextX, nextZ)) continue;
      if (
        dx !== 0 &&
        dz !== 0 &&
        (isBlocked(current.x + dx, current.z) || isBlocked(current.x, current.z + dz))
      ) {
        continue;
      }
      const moveCost = dx === 0 || dz === 0 ? 1 : Math.SQRT2;
      const tentativeG = current.g + moveCost;
      if (tentativeG >= (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(nextKey, current.key);
      gScore.set(nextKey, tentativeG);
      open.set(nextKey, {
        key: nextKey,
        x: nextX,
        z: nextZ,
        g: tentativeG,
        f: tentativeG + heuristic(nextX, nextZ, goal.x, goal.z),
      });
    }
  }
  return [];
}

function simplifyPath(path: readonly Point2[]): Point2[] {
  if (path.length < 3) return [...path];
  const simplified: Point2[] = [path[0]];
  let previousDirection = {
    x: Math.sign(path[1].x - path[0].x),
    z: Math.sign(path[1].z - path[0].z),
  };
  for (let index = 2; index < path.length; index += 1) {
    const direction = {
      x: Math.sign(path[index].x - path[index - 1].x),
      z: Math.sign(path[index].z - path[index - 1].z),
    };
    if (direction.x !== previousDirection.x || direction.z !== previousDirection.z) {
      simplified.push(path[index - 1]);
      previousDirection = direction;
    }
  }
  simplified.push(path[path.length - 1]);
  return simplified;
}
