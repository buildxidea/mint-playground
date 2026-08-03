import { BONE, smoothstep, type RigMotions } from "./reactions";

/**
 * Describes the model's anatomy: where its bones sit and how a semantic motion
 * maps onto its own axes.
 *
 * `upright` is the single value driving posture: 0 = flopped out asleep,
 * 1 = sitting up. The model is sculpted sitting, so sitting is its rest pose
 * and lying down is a deformation — tipped onto its back and squashed flat.
 */
export interface RigProfile {
  /** mint-assets.json key for this model. */
  assetKey: string;
  /** Bone pivots in normalized model space (-1..1 per axis). */
  pivots: [number, number, number][];
  /** Mouth position in normalized model space, for the snore bubble. */
  mouth: [number, number, number];
  /** Per-vertex bone weights from normalized position. */
  weights(nx: number, ny: number, nz: number): number[];
  motions: RigMotions;
}

/**
 * "Pastel Belly" — sculpted sitting upright. Head at +Y, arms at ±X, legs low
 * and forward at +Z, belly facing +Z. While he sleeps the model is tipped
 * -90° about X, so his local +Z points at the sky: a head turn is a Z rotation,
 * which is why reactions ask for semantic motions instead of naming axes.
 */
export const SNORLAX_PROFILE: RigProfile = {
  assetKey: "snorlax",
  pivots: [
    [0, 0.2, -0.05],
    [-0.6, 0.2, 0],
    [0.6, 0.2, 0],
    [-0.42, -0.55, 0.1],
    [0.42, -0.55, 0.1],
    [0, -0.05, 0.3],
    [0, -0.85, -0.2],
  ],
  mouth: [0, 0.58, 0.45],
  weights(nx, ny, nz) {
    const ax = Math.abs(nx);
    const head = smoothstep(ny, 0.28, 0.72) * (1 - smoothstep(ax, 0.72, 1.0));
    const armBand =
      (1 - smoothstep(ny, 0.3, 0.62)) *
      (1 - smoothstep(-ny, 0.55, 0.92)) *
      (1 - smoothstep(nz, 0.5, 0.95));
    const armL = smoothstep(-nx, 0.58, 0.95) * armBand;
    const armR = smoothstep(nx, 0.58, 0.95) * armBand;
    const legBand = smoothstep(-ny, 0.35, 0.8) * smoothstep(nz, 0.2, 0.7);
    const footL = legBand * smoothstep(-nx, 0.02, 0.45);
    const footR = legBand * smoothstep(nx, 0.02, 0.45);
    const belly =
      smoothstep(nz, 0.35, 0.85) *
      (1 - smoothstep(ax, 0.35, 0.8)) *
      (1 - smoothstep(ny, 0.35, 0.7)) *
      (1 - smoothstep(-ny, 0.45, 0.85));
    const torso = smoothstep(ny, -0.85, -0.35);
    return [head, armL, armR, footL, footR, belly, torso];
  },
  motions: {
    headYaw: (p, a) => { p[BONE.HEAD].rz += a; },
    headNod: (p, a) => { p[BONE.HEAD].rx += a; },
    headTilt: (p, a) => { p[BONE.HEAD].ry += a; },
    // Arms hang along -Y; rotating about X swings them up over his belly.
    armLift: (p, side, a) => { p[side < 0 ? BONE.ARM_L : BONE.ARM_R].rx += a; },
    armSweep: (p, side, a) => { p[side < 0 ? BONE.ARM_L : BONE.ARM_R].rz += -side * a; },
    legKick: (p, side, a) => { p[side < 0 ? BONE.FOOT_L : BONE.FOOT_R].rx += a; },
    bellyPush: (p, a) => { p[BONE.BELLY].tz += a; },
    bellyShift: (p, a) => { p[BONE.BELLY].tx += a; },
    // His head-to-toe axis is local Y, so rolling about it is a Y rotation.
    torsoTwist: (p, a) => { p[BONE.TORSO].ry += a; },
    torsoShift: (p, a) => { p[BONE.TORSO].tx += a; },
    // Legs hang along -Y; rotating about Z swings them apart sideways.
    legSplay: (p, side, a) => { p[side < 0 ? BONE.FOOT_L : BONE.FOOT_R].rz += -side * a; },
    footCurl: (p, side, a) => { p[side < 0 ? BONE.FOOT_L : BONE.FOOT_R].ry += a; },
  },
};

/** How the sculpted sitting pose is deformed into a sleeping one. */
export const POSE_CONFIG = {
  /** How far he rises when woken; 1 is a full upright sit. */
  maxUpright: 1,
  /** How far he is squashed flat when fully asleep. */
  flatten: 0.2,
  /** How far his limbs splay out when fully asleep. */
  sprawl: 0,
};
