import * as THREE from "three";

export type SeatedLookMode = "natural" | "free";

export const SEATED_OCCUPANT_CONTRACT_VERSION = "1.0.0";

export type SeatPerspectiveId =
  | "authentic-forward"
  | "midfield"
  | "near-goal"
  | "far-goal"
  | "north-board"
  | "south-board"
  | "left-context"
  | "right-context";

export type SeatPerspective = {
  id: SeatPerspectiveId;
  label: string;
  shortLabel: string;
  description: string;
};

export const SEAT_PERSPECTIVES: SeatPerspective[] = [
  {
    id: "authentic-forward",
    label: "Seat forward",
    shortLabel: "Forward",
    description: "The modeled direction the selected chair faces.",
  },
  {
    id: "midfield",
    label: "Midfield",
    shortLabel: "Midfield",
    description: "Centered on the field midpoint.",
  },
  {
    id: "near-goal",
    label: "Near goal",
    shortLabel: "Near goal",
    description: "A seated look toward the nearer end zone.",
  },
  {
    id: "far-goal",
    label: "Far goal",
    shortLabel: "Far goal",
    description: "A seated look toward the opposite end zone.",
  },
  {
    id: "north-board",
    label: "North scoreboard",
    shortLabel: "North board",
    description: "Centers the current north video-board object.",
  },
  {
    id: "south-board",
    label: "South scoreboard",
    shortLabel: "South board",
    description: "Centers the current south video-board object.",
  },
  {
    id: "left-context",
    label: "Look left along row",
    shortLabel: "Row left",
    description: "A ninety-degree head turn showing neighboring seats and aisles.",
  },
  {
    id: "right-context",
    label: "Look right along row",
    shortLabel: "Row right",
    description: "A ninety-degree head turn showing neighboring seats and aisles.",
  },
];

export const SEATED_EYE_FORWARD_OFFSET_M = 0.18;
export const NATURAL_YAW_LIMIT_RAD = THREE.MathUtils.degToRad(110);
export const SEATED_PITCH_MIN_RAD = THREE.MathUtils.degToRad(-70);
export const SEATED_PITCH_MAX_RAD = THREE.MathUtils.degToRad(70);
export const SEATED_FOV_MIN_DEG = 42;
export const SEATED_FOV_MAX_DEG = 75;
export const SEATED_LEAN_LIMITS_M = Object.freeze({
  lateral: 0.25,
  forward: 0.18,
  vertical: 0.12,
});

export type SeatLocalLean = {
  lateral: number;
  forward: number;
  vertical: number;
};

export function seatedBasis(yawRad: number): {
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
} {
  const forward = new THREE.Vector3(Math.sin(yawRad), 0, Math.cos(yawRad)).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  return { forward, right, up };
}

export function clampSeatLocalLean(lean: SeatLocalLean): SeatLocalLean {
  return {
    lateral: THREE.MathUtils.clamp(
      lean.lateral,
      -SEATED_LEAN_LIMITS_M.lateral,
      SEATED_LEAN_LIMITS_M.lateral,
    ),
    forward: THREE.MathUtils.clamp(
      lean.forward,
      -SEATED_LEAN_LIMITS_M.forward,
      SEATED_LEAN_LIMITS_M.forward,
    ),
    vertical: THREE.MathUtils.clamp(
      lean.vertical,
      -SEATED_LEAN_LIMITS_M.vertical,
      SEATED_LEAN_LIMITS_M.vertical,
    ),
  };
}

export function createSeatOccupantEye(
  anchor: THREE.Vector3,
  yawRad: number,
  eyeHeightM: number,
  heightOffsetM = 0,
  lean: SeatLocalLean = { lateral: 0, forward: 0, vertical: 0 },
): THREE.Vector3 {
  const basis = seatedBasis(yawRad);
  const safeLean = clampSeatLocalLean(lean);
  return anchor
    .clone()
    .addScaledVector(basis.forward, SEATED_EYE_FORWARD_OFFSET_M + safeLean.forward)
    .addScaledVector(basis.right, safeLean.lateral)
    .addScaledVector(basis.up, eyeHeightM + heightOffsetM + safeLean.vertical);
}

export function wrapSignedAngle(angle: number): number {
  return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
}

export function perspectiveCountForAnchors(anchorCount: number): number {
  return anchorCount * SEAT_PERSPECTIVES.length;
}
