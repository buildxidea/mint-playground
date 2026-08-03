/**
 * Procedural "bothered while sleeping" reactions.
 *
 * The Snorlax GLBs are single unrigged meshes, so instead of skeletal clips we
 * drive virtual bones whose vertex weights are painted from object-space
 * position. Two different models are supported — one sculpted lying down and
 * one sculpted sitting — and their local axes do not agree, so reactions never
 * touch euler components directly. They ask the rig for a *semantic* motion
 * ("turn his head", "lift that arm") and each rig profile maps it onto its own
 * axes. See rigProfiles.ts.
 */

export const BONE = {
  HEAD: 0,
  ARM_L: 1,
  ARM_R: 2,
  FOOT_L: 3,
  FOOT_R: 4,
  BELLY: 5,
  /** Everything above the hips; used for the sit-up hinge. */
  TORSO: 6,
} as const;

export const BONE_COUNT = 7;

export interface PoseBone {
  rx: number;
  ry: number;
  rz: number;
  tx: number;
  ty: number;
  tz: number;
}

export type Pose = PoseBone[];

export function createPose(): Pose {
  return Array.from({ length: BONE_COUNT }, () => ({
    rx: 0, ry: 0, rz: 0, tx: 0, ty: 0, tz: 0,
  }));
}

export function resetPose(pose: Pose) {
  for (const bone of pose) {
    bone.rx = 0; bone.ry = 0; bone.rz = 0;
    bone.tx = 0; bone.ty = 0; bone.tz = 0;
  }
}

/** Semantic motions a rig profile knows how to perform on its own anatomy. */
export interface RigMotions {
  /** Turn his face left and right, as in shaking his head "no". */
  headYaw(pose: Pose, amount: number): void;
  /** Tip his chin down and up. */
  headNod(pose: Pose, amount: number): void;
  /** Tilt his head ear-toward-shoulder. */
  headTilt(pose: Pose, amount: number): void;
  /** Raise an arm away from his body, toward the side his belly faces. */
  armLift(pose: Pose, side: number, amount: number): void;
  /** Swing an arm across his body. */
  armSweep(pose: Pose, side: number, amount: number): void;
  /** Kick a leg. */
  legKick(pose: Pose, side: number, amount: number): void;
  /** Push his belly out, the direction it swells when he breathes. */
  bellyPush(pose: Pose, amount: number): void;
  /** Slide his belly sideways. */
  bellyShift(pose: Pose, amount: number): void;
  /** Roll his upper body about his head-to-toe axis, as in squirming. */
  torsoTwist(pose: Pose, amount: number): void;
  /** Shove his whole body sideways along the ground. */
  torsoShift(pose: Pose, amount: number): void;
  /** Swing a leg out away from the other, or back in. */
  legSplay(pose: Pose, side: number, amount: number): void;
  /** Twist a foot on its own, without moving the leg. */
  footCurl(pose: Pose, side: number, amount: number): void;
}

const TAU = Math.PI * 2;

export function smoothstep(x: number, min: number, max: number) {
  const t = Math.min(1, Math.max(0, (x - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

/** Rises and falls once across the reaction, so motions start and end at rest. */
function bell(t: number, duration: number) {
  return Math.sin(Math.PI * Math.min(t / duration, 1));
}

export interface Reaction {
  name: string;
  duration: number;
  /** Annoyance level at which this reaction starts showing up. */
  minAnnoyance: number;
  /** side is -1 (left) or +1 (right); ignored by symmetric reactions. */
  apply(t: number, amp: number, side: number, pose: Pose, m: RigMotions): void;
}

/** A barely-there flinch — the mildest possible "go away". */
const twitch: Reaction = {
  name: "twitch",
  duration: 0.65,
  minAnnoyance: 0,
  apply(t, amp, _side, pose, m) {
    const env = Math.exp(-6 * t) * smoothstep(t, 0, 0.05);
    m.headNod(pose, amp * 0.10 * Math.sin(TAU * 7 * t) * env);
    m.bellyPush(pose, amp * 0.012 * Math.sin(TAU * 6 * t) * env);
  },
};

/** Slow "no, not now" — turns his face side to side. */
const headShake: Reaction = {
  name: "headShake",
  duration: 1.25,
  minAnnoyance: 0,
  apply(t, amp, _side, pose, m) {
    const env = bell(t, this.duration);
    m.headYaw(pose, amp * 0.30 * Math.sin(TAU * 2.5 * t) * env);
    m.headTilt(pose, amp * 0.09 * Math.sin(TAU * 2.5 * t + 0.8) * env);
  },
};

/** Both legs paddle at the air, the near one harder. */
const footKick: Reaction = {
  name: "footKick",
  duration: 1.2,
  minAnnoyance: 0.18,
  apply(t, amp, side, pose, m) {
    const env = Math.exp(-2.6 * t) * smoothstep(t, 0, 0.06);
    m.legKick(pose, side, amp * 0.62 * Math.sin(TAU * 3.4 * t) * env);
    m.legKick(pose, -side, amp * 0.36 * Math.sin(TAU * 3.4 * t + 2.1) * env);
  },
};

/** One arm sweeps up over his body to shoo the poke away, then flops back. */
const armSwat: Reaction = {
  name: "armSwat",
  duration: 1.35,
  minAnnoyance: 0.28,
  apply(t, amp, side, pose, m) {
    const outPhase = 0.3 * this.duration;
    const swing = t < outPhase
      ? 1 - Math.pow(1 - t / outPhase, 3)
      : 1 - smoothstep(t, outPhase, this.duration);
    m.armLift(pose, side, amp * 0.85 * swing);
    m.armSweep(pose, side, amp * 0.40 * swing);
    m.headYaw(pose, side * amp * 0.10 * swing);
  },
};

/** Sleepy circular tummy rub — his belly faces the sky while he sleeps. */
const tummyRub: Reaction = {
  name: "tummyRub",
  duration: 2.5,
  minAnnoyance: 0.45,
  apply(t, amp, side, pose, m) {
    const reach = smoothstep(t, 0, 0.32 * this.duration) * (1 - smoothstep(t, 0.72 * this.duration, this.duration));
    const circle = TAU * 1.1 * t;
    m.armLift(pose, side, amp * (0.95 + 0.16 * Math.cos(circle)) * reach);
    m.armSweep(pose, side, amp * (0.45 + 0.14 * Math.sin(circle)) * reach);
    // The belly answers the rub with a soft roll.
    m.bellyPush(pose, -amp * 0.016 * reach * (0.5 + 0.5 * Math.sin(circle)));
    m.bellyShift(pose, amp * 0.012 * Math.sin(circle) * reach);
  },
};

/** Whole-body grumpy shudder. */
const grumble: Reaction = {
  name: "grumble",
  duration: 1.05,
  minAnnoyance: 0.55,
  apply(t, amp, _side, pose, m) {
    const env = bell(t, this.duration);
    const shudder = Math.sin(TAU * 8 * t);
    const offbeat = Math.sin(TAU * 8 * t + 1.2);
    m.headNod(pose, amp * 0.16 * shudder * env);
    m.headTilt(pose, amp * 0.13 * Math.sin(TAU * 8 * t + 0.7) * env);
    m.bellyPush(pose, amp * 0.035 * shudder * env);
    m.legKick(pose, -1, amp * 0.30 * shudder * env);
    m.legKick(pose, 1, amp * 0.30 * offbeat * env);
    m.armLift(pose, -1, amp * 0.18 * shudder * env);
    m.armLift(pose, 1, amp * 0.18 * offbeat * env);
  },
};

/** One foot twitches on its own, the way a sleeping animal's does. */
const footTwitch: Reaction = {
  name: "footTwitch",
  duration: 0.85,
  minAnnoyance: 0,
  apply(t, amp, side, pose, m) {
    const env = Math.exp(-4 * t) * smoothstep(t, 0, 0.04);
    m.legKick(pose, side, amp * 0.24 * Math.sin(TAU * 9 * t) * env);
    m.footCurl(pose, side, amp * 0.18 * Math.sin(TAU * 7 * t + 0.5) * env);
  },
};

/** Restless shuffling, both legs paddling out of step with each other. */
const legShuffle: Reaction = {
  name: "legShuffle",
  duration: 1.7,
  minAnnoyance: 0.12,
  apply(t, amp, _side, pose, m) {
    const env = bell(t, this.duration);
    const beat = TAU * 1.6 * t;
    m.legKick(pose, -1, amp * 0.36 * Math.sin(beat) * env);
    m.legKick(pose, 1, amp * 0.36 * Math.sin(beat + Math.PI) * env);
    m.legSplay(pose, -1, amp * 0.20 * Math.sin(beat + 0.7) * env);
    m.legSplay(pose, 1, amp * 0.20 * Math.sin(beat + Math.PI + 0.7) * env);
    m.footCurl(pose, -1, amp * 0.12 * Math.sin(beat * 1.5) * env);
  },
};

/** Rolls uncomfortably from side to side, trying to settle again. */
const squirm: Reaction = {
  name: "squirm",
  duration: 2.0,
  minAnnoyance: 0.22,
  apply(t, amp, _side, pose, m) {
    const env = bell(t, this.duration);
    const roll = TAU * 0.9 * t;
    m.torsoTwist(pose, amp * 0.24 * Math.sin(roll) * env);
    m.torsoShift(pose, amp * 0.022 * Math.sin(roll + 0.4) * env);
    // His head lags behind the roll, as dead weight would.
    m.headYaw(pose, -amp * 0.15 * Math.sin(roll - 0.5) * env);
    m.bellyPush(pose, amp * 0.014 * Math.sin(roll * 2) * env);
  },
};

/** Stretches out the arm and leg on one side, then lets them drop. */
const armStretch: Reaction = {
  name: "armStretch",
  duration: 1.9,
  minAnnoyance: 0.3,
  apply(t, amp, side, pose, m) {
    const reach = smoothstep(t, 0, 0.35 * this.duration) * (1 - smoothstep(t, 0.6 * this.duration, this.duration));
    m.armLift(pose, side, -amp * 0.72 * reach);
    m.armSweep(pose, side, amp * 0.45 * reach);
    m.legKick(pose, side, amp * 0.28 * reach);
    m.headTilt(pose, -side * amp * 0.12 * reach);
  },
};

/** Turns his face away and presses it down, hiding from the poking. */
const headBurrow: Reaction = {
  name: "headBurrow",
  duration: 1.6,
  minAnnoyance: 0.3,
  apply(t, amp, side, pose, m) {
    const push = smoothstep(t, 0, 0.3 * this.duration) * (1 - smoothstep(t, 0.55 * this.duration, this.duration));
    m.headYaw(pose, -side * amp * 0.45 * push);
    m.headNod(pose, amp * 0.32 * push);
    m.headTilt(pose, side * amp * 0.18 * push);
    m.armLift(pose, -side, amp * 0.3 * push);
  },
};

/** A quick shiver runs through all of him at once. */
const shiver: Reaction = {
  name: "shiver",
  duration: 0.95,
  minAnnoyance: 0.4,
  apply(t, amp, _side, pose, m) {
    const env = bell(t, this.duration);
    const fast = Math.sin(TAU * 14 * t);
    const offbeat = Math.sin(TAU * 14 * t + 1.1);
    m.torsoTwist(pose, amp * 0.09 * fast * env);
    m.headNod(pose, amp * 0.13 * fast * env);
    m.legKick(pose, -1, amp * 0.20 * fast * env);
    m.legKick(pose, 1, amp * 0.20 * offbeat * env);
    m.armLift(pose, -1, amp * 0.16 * fast * env);
    m.armLift(pose, 1, amp * 0.16 * offbeat * env);
    m.bellyPush(pose, amp * 0.014 * fast * env);
  },
};

/** A full four-limb stretch, the big luxurious kind, then everything flops. */
const bigStretch: Reaction = {
  name: "bigStretch",
  duration: 2.7,
  minAnnoyance: 0.5,
  apply(t, amp, _side, pose, m) {
    const reach = smoothstep(t, 0, 0.4 * this.duration) * (1 - smoothstep(t, 0.55 * this.duration, this.duration));
    m.armLift(pose, -1, -amp * 0.78 * reach);
    m.armLift(pose, 1, -amp * 0.78 * reach);
    m.legKick(pose, -1, amp * 0.52 * reach);
    m.legKick(pose, 1, amp * 0.52 * reach);
    m.legSplay(pose, -1, amp * 0.26 * reach);
    m.legSplay(pose, 1, amp * 0.26 * reach);
    m.headNod(pose, -amp * 0.3 * reach);
    m.bellyPush(pose, amp * 0.032 * reach);
  },
};

/** Heaves his whole body over, away from whoever keeps poking him. */
const rollAway: Reaction = {
  name: "rollAway",
  duration: 2.3,
  minAnnoyance: 0.6,
  apply(t, amp, side, pose, m) {
    const turn = smoothstep(t, 0, 0.4 * this.duration) * (1 - smoothstep(t, 0.65 * this.duration, this.duration));
    m.torsoTwist(pose, -side * amp * 0.42 * turn);
    m.torsoShift(pose, -side * amp * 0.03 * turn);
    m.headYaw(pose, -side * amp * 0.38 * turn);
    m.armSweep(pose, side, amp * 0.32 * turn);
    m.legSplay(pose, -side, amp * 0.22 * turn);
  },
};

export const REACTIONS: Reaction[] = [
  twitch, headShake, footKick, armSwat, tummyRub, grumble,
  footTwitch, legShuffle, squirm, armStretch, headBurrow, shiver, bigStretch, rollAway,
];

/** How many recent reactions to avoid repeating. */
export const REACTION_MEMORY = 4;

/**
 * Picks a reaction suited to how bothered Snorlax currently is, avoiding the
 * handful he just did so a long poking session keeps producing new behaviour
 * rather than cycling through the same two or three.
 */
export function pickReaction(annoyance: number, recent: readonly Reaction[]): Reaction {
  const eligible = REACTIONS.filter((r) => annoyance >= r.minAnnoyance);
  const pool = eligible.length > 0 ? eligible : [twitch];
  // Once he is properly bothered, mostly stop offering the mildest reactions.
  const weighted = pool.filter((r) => annoyance < 0.35 || r.minAnnoyance > 0 || Math.random() < 0.4);
  const choices = weighted.length > 0 ? weighted : pool;
  // Never let the memory empty the pool: fall back to the least recent.
  const fresh = choices.filter((r) => !recent.includes(r));
  const final = fresh.length > 0 ? fresh : choices.filter((r) => r !== recent[recent.length - 1]);
  const usable = final.length > 0 ? final : choices;
  return usable[Math.floor(Math.random() * usable.length)];
}
