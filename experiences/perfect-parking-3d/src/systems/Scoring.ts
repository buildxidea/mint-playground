export type ScoreInput = {
  align: number;
  elapsed: number;
  parTime: number;
  collisions: number;
  lineViolations: number;
};

export type ScoreResult = {
  score: number;
  stars: 0 | 1 | 2 | 3;
  timeFactor: number;
};

export function computeAlign(
  carX: number,
  carZ: number,
  carYaw: number,
  bayX: number,
  bayZ: number,
  bayYaw: number,
  maxDist = 2.2,
  maxYaw = Math.PI / 3,
): number {
  const dx = carX - bayX;
  const dz = carZ - bayZ;
  const dist = Math.hypot(dx, dz);
  const posScore = Math.max(0, 1 - dist / maxDist);
  let yawErr = Math.abs(normalizeAngle(carYaw - bayYaw));
  yawErr = Math.min(yawErr, Math.PI - yawErr);
  const yawScore = Math.max(0, 1 - yawErr / maxYaw);
  return clamp01(0.55 * posScore + 0.45 * yawScore);
}

export function computeScore(input: ScoreInput): ScoreResult {
  const timeRatio = input.elapsed / Math.max(1, input.parTime);
  const timeFactor = clamp(1.05 - 0.25 * Math.max(0, timeRatio - 1), 0.55, 1);
  let score =
    100 * clamp(input.align, 0.5, 1) * timeFactor -
    12 * input.collisions -
    8 * input.lineViolations;
  score = Math.max(0, Math.min(100, score));

  let stars: 0 | 1 | 2 | 3 = 0;
  if (score >= 85 && input.collisions <= 1) stars = 3;
  else if (score >= 65) stars = 2;
  else if (score >= 40) stars = 1;
  else stars = 1; // parked consolation

  return { score, stars, timeFactor };
}

export function pointInOrientedBox(
  px: number,
  pz: number,
  cx: number,
  cz: number,
  yaw: number,
  halfW: number,
  halfL: number,
): boolean {
  const dx = px - cx;
  const dz = pz - cz;
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  const localX = dx * c - dz * s;
  const localZ = dx * s + dz * c;
  return Math.abs(localX) <= halfW && Math.abs(localZ) <= halfL;
}

/** Vehicle fully inside bay using four corners. */
export function vehicleInsideBay(
  x: number,
  z: number,
  yaw: number,
  halfLength: number,
  halfWidth: number,
  bay: { x: number; z: number; yaw: number; width: number; length: number },
  margin = 0.02,
): boolean {
  return vehicleBayClearance(x, z, yaw, halfLength, halfWidth, bay) >= margin;
}

/** Minimum signed distance from any vehicle corner to the bay's painted edge. */
export function vehicleBayClearance(
  x: number,
  z: number,
  yaw: number,
  halfLength: number,
  halfWidth: number,
  bay: { x: number; z: number; yaw: number; width: number; length: number },
): number {
  const corners = vehicleCorners(x, z, yaw, halfLength, halfWidth);
  const c = Math.cos(-bay.yaw);
  const s = Math.sin(-bay.yaw);
  let clearance = Infinity;
  for (const [cx, cz] of corners) {
    const dx = cx - bay.x;
    const dz = cz - bay.z;
    const localX = dx * c - dz * s;
    const localZ = dx * s + dz * c;
    clearance = Math.min(
      clearance,
      bay.width / 2 - Math.abs(localX),
      bay.length / 2 - Math.abs(localZ),
    );
  }
  return clearance;
}

export function vehicleCorners(
  x: number,
  z: number,
  yaw: number,
  halfLength: number,
  halfWidth: number,
): Array<[number, number]> {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const offsets: Array<[number, number]> = [
    [halfWidth, halfLength],
    [-halfWidth, halfLength],
    [halfWidth, -halfLength],
    [-halfWidth, -halfLength],
  ];
  return offsets.map(([ox, oz]) => [x + ox * c - oz * s, z + ox * s + oz * c]);
}

export function normalizeAngle(a: number): number {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
