import * as THREE from 'three';
import type { AxiomJumpPose } from './AxiomJumpMotion';

export const AXIOM_JOINT_NAMES = [
  'Hips',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'LeftToeBase',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
  'RightToeBase',
  'Spine02',
  'Spine01',
  'Spine',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'neck',
  'Head',
  'head_end',
  'headfront',
] as const;

export type AxiomJointName = (typeof AXIOM_JOINT_NAMES)[number];

export const AXIOM_SOCKET_NAMES = [
  'left-grasp',
  'right-grasp',
  'left-foot-contact',
  'right-foot-contact',
  'head-camera',
  'chest-depth',
  'left-wrist-camera',
  'right-wrist-camera',
  'center-of-mass',
  'dock',
] as const;

export type AxiomSocketName = (typeof AXIOM_SOCKET_NAMES)[number];

type AxisLimit = readonly [minimum: number, maximum: number];
type Tuple3 = readonly [number, number, number];

export type AxiomJointLimit = Readonly<{
  x: AxisLimit;
  y: AxisLimit;
  z: AxisLimit;
}>;

const degrees = (minimum: number, maximum: number): AxisLimit => [
  THREE.MathUtils.degToRad(minimum),
  THREE.MathUtils.degToRad(maximum),
];

const fixed = (): AxiomJointLimit => ({
  x: [0, 0],
  y: [0, 0],
  z: [0, 0],
});

/**
 * Conservative runtime envelopes relative to the imported neutral pose.
 * The Mint asset does not contain manufacturer limits, so these are the
 * reviewed Forge-5 engineering limits used for simulation actuation only.
 */
export const AXIOM_JOINT_LIMITS: Readonly<Record<AxiomJointName, AxiomJointLimit>> = {
  Hips: { x: degrees(-20, 25), y: degrees(-35, 35), z: degrees(-18, 18) },
  LeftUpLeg: { x: degrees(-105, 45), y: degrees(-30, 30), z: degrees(-35, 35) },
  LeftLeg: { x: degrees(0, 135), y: degrees(-5, 5), z: degrees(-5, 5) },
  LeftFoot: { x: degrees(-35, 45), y: degrees(-15, 15), z: degrees(-22, 22) },
  LeftToeBase: { x: degrees(-20, 40), y: degrees(-3, 3), z: degrees(-3, 3) },
  RightUpLeg: { x: degrees(-105, 45), y: degrees(-30, 30), z: degrees(-35, 35) },
  RightLeg: { x: degrees(0, 135), y: degrees(-5, 5), z: degrees(-5, 5) },
  RightFoot: { x: degrees(-35, 45), y: degrees(-15, 15), z: degrees(-22, 22) },
  RightToeBase: { x: degrees(-20, 40), y: degrees(-3, 3), z: degrees(-3, 3) },
  Spine02: { x: degrees(-18, 25), y: degrees(-25, 25), z: degrees(-16, 16) },
  Spine01: { x: degrees(-15, 20), y: degrees(-20, 20), z: degrees(-12, 12) },
  Spine: { x: degrees(-12, 18), y: degrees(-18, 18), z: degrees(-12, 12) },
  LeftShoulder: { x: degrees(-25, 25), y: degrees(-25, 25), z: degrees(-35, 35) },
  LeftArm: { x: degrees(-100, 110), y: degrees(-95, 95), z: degrees(-115, 90) },
  LeftForeArm: { x: degrees(-10, 145), y: degrees(-70, 70), z: degrees(-10, 10) },
  LeftHand: { x: degrees(-55, 55), y: degrees(-75, 75), z: degrees(-35, 35) },
  RightShoulder: { x: degrees(-25, 25), y: degrees(-25, 25), z: degrees(-35, 35) },
  RightArm: { x: degrees(-100, 110), y: degrees(-95, 95), z: degrees(-90, 115) },
  RightForeArm: { x: degrees(-10, 145), y: degrees(-70, 70), z: degrees(-10, 10) },
  RightHand: { x: degrees(-55, 55), y: degrees(-75, 75), z: degrees(-35, 35) },
  neck: { x: degrees(-30, 35), y: degrees(-55, 55), z: degrees(-25, 25) },
  Head: { x: degrees(-20, 25), y: degrees(-35, 35), z: degrees(-18, 18) },
  head_end: fixed(),
  headfront: fixed(),
};

const EXPECTED_PARENT: Readonly<Partial<Record<AxiomJointName, AxiomJointName>>> = {
  LeftUpLeg: 'Hips',
  LeftLeg: 'LeftUpLeg',
  LeftFoot: 'LeftLeg',
  LeftToeBase: 'LeftFoot',
  RightUpLeg: 'Hips',
  RightLeg: 'RightUpLeg',
  RightFoot: 'RightLeg',
  RightToeBase: 'RightFoot',
  Spine02: 'Hips',
  Spine01: 'Spine02',
  Spine: 'Spine01',
  LeftShoulder: 'Spine',
  LeftArm: 'LeftShoulder',
  LeftForeArm: 'LeftArm',
  LeftHand: 'LeftForeArm',
  RightShoulder: 'Spine',
  RightArm: 'RightShoulder',
  RightForeArm: 'RightArm',
  RightHand: 'RightForeArm',
  neck: 'Spine',
  Head: 'neck',
  head_end: 'Head',
  headfront: 'Head',
};

const SOCKET_JOINT: Readonly<Record<AxiomSocketName, AxiomJointName>> = {
  'left-grasp': 'LeftHand',
  'right-grasp': 'RightHand',
  'left-foot-contact': 'LeftToeBase',
  'right-foot-contact': 'RightToeBase',
  'head-camera': 'headfront',
  'chest-depth': 'Spine',
  'left-wrist-camera': 'LeftHand',
  'right-wrist-camera': 'RightHand',
  'center-of-mass': 'Hips',
  dock: 'Spine02',
};

/**
 * Joint-local authored-unit offsets. The Mint armature is authored in
 * centimeters beneath a 0.01 Armature scale, so 10 authored units become
 * approximately 0.1 m before the visual's final normalization scale.
 */
export const AXIOM_SOCKET_OFFSETS: Readonly<Record<AxiomSocketName, Tuple3>> = {
  'left-grasp': [0, 10, 0],
  'right-grasp': [0, 10, 0],
  'left-foot-contact': [0, 5.5, 0],
  'right-foot-contact': [0, 5.5, 0],
  'head-camera': [0, 0, 0],
  'chest-depth': [0, 4, 3],
  'left-wrist-camera': [0, 6, 2],
  'right-wrist-camera': [0, 6, 2],
  'center-of-mass': [0, 0, 0],
  dock: [0, -5, 7],
};

export type AxiomRestJoint = Readonly<{
  position: Tuple3;
  quaternion: readonly [number, number, number, number];
  scale: Tuple3;
}>;

export type AxiomReachSolution = Readonly<{
  targetForward: number;
  targetHeight: number;
  shoulderRadians: number;
  elbowRadians: number;
  errorMeters: number;
}>;

export type AxiomActuationObservation = {
  sequence: number;
  mode: 'idle' | 'bimanual-reach';
  phase: number;
  reachTarget: Tuple3;
  reachErrorMeters: number;
  jointDeltas: Readonly<Partial<Record<AxiomJointName, readonly [number, number, number]>>>;
  endEffectors: Readonly<{
    left: Readonly<{ target: Tuple3; actual: Tuple3; errorMeters: number }>;
    right: Readonly<{ target: Tuple3; actual: Tuple3; errorMeters: number }>;
  }> | null;
};

export type AxiomBimanualTargets = Readonly<{
  left: THREE.Vector3;
  right: THREE.Vector3;
}>;

export type AxiomRigBinding = Readonly<{
  source: 'mint-axiom-h1-24-joint-rig';
  limitStatus: 'runtime-engineering-envelope-v1';
  socketStatus: 'runtime-calibrated-offsets-v1';
  joints: Readonly<Record<AxiomJointName, THREE.Object3D>>;
  sockets: Readonly<Record<AxiomSocketName, THREE.Group>>;
  restPose: Readonly<Record<AxiomJointName, AxiomRestJoint>>;
  actuation: AxiomActuationObservation;
}>;

const tuple3 = (value: THREE.Vector3): readonly [number, number, number] => [
  value.x,
  value.y,
  value.z,
];

const tuple4 = (value: THREE.Quaternion): readonly [number, number, number, number] => [
  value.x,
  value.y,
  value.z,
  value.w,
];

export function bindAxiomRig(root: THREE.Object3D): AxiomRigBinding {
  const matches = new Map<AxiomJointName, THREE.Object3D[]>(
    AXIOM_JOINT_NAMES.map((name) => [name, []]),
  );
  root.traverse((object) => {
    if (matches.has(object.name as AxiomJointName)) {
      matches.get(object.name as AxiomJointName)?.push(object);
    }
  });

  const joints = {} as Record<AxiomJointName, THREE.Object3D>;
  for (const name of AXIOM_JOINT_NAMES) {
    const candidates = matches.get(name) ?? [];
    if (candidates.length !== 1) {
      throw new Error(`AXIOM rig requires exactly one "${name}" joint; found ${candidates.length}`);
    }
    joints[name] = candidates[0];
  }

  for (const [childName, parentName] of Object.entries(EXPECTED_PARENT) as [
    AxiomJointName,
    AxiomJointName,
  ][]) {
    if (joints[childName].parent !== joints[parentName]) {
      throw new Error(
        `AXIOM rig hierarchy mismatch: ${childName} must be parented to ${parentName}`,
      );
    }
  }

  const sockets = {} as Record<AxiomSocketName, THREE.Group>;
  for (const name of AXIOM_SOCKET_NAMES) {
    const socket = new THREE.Group();
    socket.name = `axiom-h1:socket:${name}`;
    socket.userData.socketName = name;
    socket.userData.reviewStatus = 'runtime-calibrated-offsets-v1';
    socket.userData.localAxes = {
      x: 'authored-joint-local-x',
      y: 'authored-joint-local-y',
      z: 'authored-joint-local-z',
    };
    socket.position.set(...AXIOM_SOCKET_OFFSETS[name]);
    joints[SOCKET_JOINT[name]].add(socket);
    sockets[name] = socket;
  }

  const restPose = {} as Record<AxiomJointName, AxiomRestJoint>;
  for (const name of AXIOM_JOINT_NAMES) {
    const joint = joints[name];
    restPose[name] = {
      position: tuple3(joint.position),
      quaternion: tuple4(joint.quaternion),
      scale: tuple3(joint.scale),
    };
  }

  return {
    source: 'mint-axiom-h1-24-joint-rig',
    limitStatus: 'runtime-engineering-envelope-v1',
    socketStatus: 'runtime-calibrated-offsets-v1',
    joints,
    sockets,
    restPose,
    actuation: {
      sequence: 0,
      mode: 'idle',
      phase: 0,
      reachTarget: [0.22, -0.34, 0],
      reachErrorMeters: 0,
      jointDeltas: {},
      endEffectors: null,
    },
  };
}

export function clampAxiomJointDelta(
  name: AxiomJointName,
  delta: THREE.Euler,
  target = new THREE.Euler(),
): THREE.Euler {
  const limit = AXIOM_JOINT_LIMITS[name];
  return target.set(
    THREE.MathUtils.clamp(Number.isFinite(delta.x) ? delta.x : 0, ...limit.x),
    THREE.MathUtils.clamp(Number.isFinite(delta.y) ? delta.y : 0, ...limit.y),
    THREE.MathUtils.clamp(Number.isFinite(delta.z) ? delta.z : 0, ...limit.z),
    delta.order,
  );
}

const AXIOM_CROUCH_DEGREES: Readonly<
  Partial<Record<AxiomJointName, readonly [number, number, number]>>
> = {
  Hips: [20, 0, 0],
  LeftUpLeg: [-72, 0, 0],
  LeftLeg: [130, 0, 0],
  LeftFoot: [-35, 0, 0],
  RightUpLeg: [-72, 0, 0],
  RightLeg: [130, 0, 0],
  RightFoot: [-35, 0, 0],
};

const AXIOM_CRAWL_DEGREES: Readonly<
  Partial<Record<AxiomJointName, readonly [number, number, number]>>
> = {
  Hips: [25, 0, 0],
  LeftUpLeg: [-95, 0, 0],
  LeftLeg: [135, 0, 0],
  LeftFoot: [-35, 0, 0],
  RightUpLeg: [-95, 0, 0],
  RightLeg: [135, 0, 0],
  RightFoot: [-35, 0, 0],
  Spine02: [25, 0, 0],
  LeftArm: [70, 0, -20],
  LeftForeArm: [25, 0, 0],
  RightArm: [70, 0, 20],
  RightForeArm: [25, 0, 0],
};

/**
 * Applies the reviewed low-clearance locomotion posture after the animation
 * mixer samples its base pose. Every requested delta is clamped through the
 * same engineering envelopes used by task-space actuation.
 */
export function applyAxiomMobilityPosture(
  binding: AxiomRigBinding,
  posture: 'standing' | 'crouched' | 'crawling',
): void {
  if (posture === 'standing') return;
  const postureDeltas = posture === 'crawling' ? AXIOM_CRAWL_DEGREES : AXIOM_CROUCH_DEGREES;
  const jointDeltas: Partial<Record<AxiomJointName, readonly [number, number, number]>> = {
    ...binding.actuation.jointDeltas,
  };
  for (const [name, degrees] of Object.entries(postureDeltas) as [
    AxiomJointName,
    readonly [number, number, number],
  ][]) {
    const requested = new THREE.Euler(
      THREE.MathUtils.degToRad(degrees[0]),
      THREE.MathUtils.degToRad(degrees[1]),
      THREE.MathUtils.degToRad(degrees[2]),
    );
    const clamped = clampAxiomJointDelta(name, requested);
    binding.joints[name].quaternion
      .multiply(new THREE.Quaternion().setFromEuler(clamped))
      .normalize();
    jointDeltas[name] = [clamped.x, clamped.y, clamped.z];
  }
  binding.actuation.jointDeltas = jointDeltas;
}

/**
 * Adds the in-place jump pose after the mixer has sampled idle/walk. World
 * translation remains owned by RobotRuntime and Rapier; this function only
 * articulates the validated AXIOM rig through its reviewed joint envelopes.
 */
export function applyAxiomJumpPose(
  binding: AxiomRigBinding,
  pose: AxiomJumpPose,
  includeArms = true,
): Readonly<Partial<Record<AxiomJointName, readonly [number, number, number]>>> {
  if (pose.weight <= 0) return {};
  const requestedDegrees: Partial<Record<AxiomJointName, readonly [number, number, number]>> = {
    Hips: [pose.hipsPitchDegrees, 0, 0],
    LeftUpLeg: [pose.thighPitchDegrees, 0, 0],
    LeftLeg: [pose.kneePitchDegrees, 0, 0],
    LeftFoot: [pose.anklePitchDegrees, 0, 0],
    RightUpLeg: [pose.thighPitchDegrees, 0, 0],
    RightLeg: [pose.kneePitchDegrees, 0, 0],
    RightFoot: [pose.anklePitchDegrees, 0, 0],
    Spine02: [pose.spinePitchDegrees * 0.58, 0, 0],
    Spine01: [pose.spinePitchDegrees * 0.42, 0, 0],
  };
  if (includeArms) {
    requestedDegrees.LeftArm = [
      pose.upperArmPitchDegrees,
      0,
      -pose.upperArmRollDegrees,
    ];
    requestedDegrees.RightArm = [
      pose.upperArmPitchDegrees,
      0,
      pose.upperArmRollDegrees,
    ];
    requestedDegrees.LeftForeArm = [pose.forearmPitchDegrees, 0, 0];
    requestedDegrees.RightForeArm = [pose.forearmPitchDegrees, 0, 0];
  }

  const applied: Partial<Record<AxiomJointName, readonly [number, number, number]>> = {};
  for (const [name, degrees] of Object.entries(requestedDegrees) as [
    AxiomJointName,
    readonly [number, number, number],
  ][]) {
    const requested = new THREE.Euler(
      THREE.MathUtils.degToRad(degrees[0]),
      THREE.MathUtils.degToRad(degrees[1]),
      THREE.MathUtils.degToRad(degrees[2]),
    );
    const clamped = clampAxiomJointDelta(name, requested);
    binding.joints[name].quaternion
      .multiply(new THREE.Quaternion().setFromEuler(clamped))
      .normalize();
    applied[name] = [clamped.x, clamped.y, clamped.z];
  }
  return applied;
}

export const AXIOM_ARM_KINEMATICS = {
  left: {
    upperArmMeters: 0.3195631980895996,
    forearmMeters: 0.3026610565185547,
    sourceNodes: ['LeftForeArm', 'LeftHand'],
  },
  right: {
    upperArmMeters: 0.32303901672363283,
    forearmMeters: 0.3051335906982422,
    sourceNodes: ['RightForeArm', 'RightHand'],
  },
} as const;

export type AxiomArmSide = keyof typeof AXIOM_ARM_KINEMATICS;

const AXIOM_REST_REACH: readonly [forward: number, height: number] = [0.22, -0.34];
const AXIOM_TASK_REACH: readonly [forward: number, height: number] = [0.4, -0.19];

/**
 * Deterministic two-link planar IK in the robot's sagittal plane. Targets are
 * clamped to the physical reach annulus so malformed task input cannot produce
 * a non-finite joint command.
 */
export function solveAxiomPlanarReach(
  targetForward: number,
  targetHeight: number,
  side: AxiomArmSide = 'left',
): AxiomReachSolution {
  const links = AXIOM_ARM_KINEMATICS[side];
  const forward = Number.isFinite(targetForward) ? targetForward : AXIOM_REST_REACH[0];
  const height = Number.isFinite(targetHeight) ? targetHeight : AXIOM_REST_REACH[1];
  const requestedDistance = Math.hypot(forward, height);
  const minimumReach = Math.abs(links.upperArmMeters - links.forearmMeters) + 0.001;
  const maximumReach = links.upperArmMeters + links.forearmMeters - 0.001;
  const distance = THREE.MathUtils.clamp(requestedDistance, minimumReach, maximumReach);
  const direction = requestedDistance > 1e-6 ? Math.atan2(height, forward) : 0;
  const resolvedForward = Math.cos(direction) * distance;
  const resolvedHeight = Math.sin(direction) * distance;
  const elbowCosine = THREE.MathUtils.clamp(
    (distance * distance -
      links.upperArmMeters * links.upperArmMeters -
      links.forearmMeters * links.forearmMeters) /
      (2 * links.upperArmMeters * links.forearmMeters),
    -1,
    1,
  );
  const elbowRadians = Math.acos(elbowCosine);
  const shoulderRadians =
    direction -
    Math.atan2(
      links.forearmMeters * Math.sin(elbowRadians),
      links.upperArmMeters + links.forearmMeters * Math.cos(elbowRadians),
    );
  const solvedForward =
    links.upperArmMeters * Math.cos(shoulderRadians) +
    links.forearmMeters * Math.cos(shoulderRadians + elbowRadians);
  const solvedHeight =
    links.upperArmMeters * Math.sin(shoulderRadians) +
    links.forearmMeters * Math.sin(shoulderRadians + elbowRadians);

  return {
    targetForward: resolvedForward,
    targetHeight: resolvedHeight,
    shoulderRadians,
    elbowRadians,
    errorMeters: Math.hypot(solvedForward - resolvedForward, solvedHeight - resolvedHeight),
  };
}

type AxiomActuatedArmJoint = 'LeftArm' | 'RightArm' | 'LeftForeArm' | 'RightForeArm';

type AxiomArmIkResult = Readonly<{
  jointDeltas: Readonly<Partial<Record<AxiomActuatedArmJoint, readonly [number, number, number]>>>;
  target: THREE.Vector3;
  actual: THREE.Vector3;
  errorMeters: number;
}>;

function optimizeAxiomArm(
  binding: AxiomRigBinding,
  side: AxiomArmSide,
  finalTarget: THREE.Vector3,
  envelope: number,
): AxiomArmIkResult {
  const upperJoint: AxiomActuatedArmJoint = side === 'left' ? 'LeftArm' : 'RightArm';
  const forearmJoint: AxiomActuatedArmJoint = side === 'left' ? 'LeftForeArm' : 'RightForeArm';
  const socket = binding.sockets[side === 'left' ? 'left-grasp' : 'right-grasp'];
  const joints = [upperJoint, forearmJoint] as const;
  const baseQuaternions = new Map(
    joints.map((name) => [name, binding.joints[name].quaternion.clone()] as const),
  );
  const deltas: Record<AxiomActuatedArmJoint, THREE.Euler> = {
    LeftArm: new THREE.Euler(),
    RightArm: new THREE.Euler(),
    LeftForeArm: new THREE.Euler(),
    RightForeArm: new THREE.Euler(),
  };
  const original = socket.getWorldPosition(new THREE.Vector3());
  const target = original.clone().lerp(finalTarget, envelope);
  const candidatePosition = new THREE.Vector3();
  const deltaQuaternion = new THREE.Quaternion();

  const apply = (): THREE.Vector3 => {
    for (const name of joints) {
      const delta = clampAxiomJointDelta(name, deltas[name], deltas[name]);
      binding.joints[name].quaternion
        .copy(baseQuaternions.get(name)!)
        .multiply(deltaQuaternion.setFromEuler(delta))
        .normalize();
    }
    socket.updateWorldMatrix(true, false);
    return socket.getWorldPosition(candidatePosition);
  };

  let bestPosition = apply().clone();
  let bestError = bestPosition.distanceToSquared(target);
  const parameters: readonly Readonly<{
    joint: AxiomActuatedArmJoint;
    axis: 'x' | 'z';
  }>[] = [
    { joint: upperJoint, axis: 'x' },
    { joint: upperJoint, axis: 'z' },
    { joint: forearmJoint, axis: 'x' },
    { joint: forearmJoint, axis: 'z' },
  ];

  for (const step of [0.35, 0.18, 0.09, 0.045]) {
    for (const parameter of parameters) {
      const delta = deltas[parameter.joint];
      const originalValue = delta[parameter.axis];
      let selectedValue = originalValue;
      let selectedError = bestError;
      for (const direction of [-1, 1]) {
        const limit = AXIOM_JOINT_LIMITS[parameter.joint][parameter.axis];
        delta[parameter.axis] = THREE.MathUtils.clamp(
          originalValue + direction * step,
          limit[0],
          limit[1],
        );
        const candidate = apply();
        const error = candidate.distanceToSquared(target);
        if (error < selectedError) {
          selectedValue = delta[parameter.axis];
          selectedError = error;
        }
      }
      delta[parameter.axis] = selectedValue;
      bestPosition = apply().clone();
      bestError = bestPosition.distanceToSquared(target);
    }
  }

  const jointDeltas: Partial<Record<AxiomActuatedArmJoint, readonly [number, number, number]>> = {};
  for (const name of joints) {
    const delta = deltas[name];
    jointDeltas[name] = [delta.x, delta.y, delta.z];
  }
  return {
    jointDeltas,
    target,
    actual: bestPosition,
    errorMeters: Math.sqrt(bestError),
  };
}

/**
 * Applies a mirrored, limit-clamped two-arm reach after the animation mixer has
 * sampled its base pose. A null phase records idle without changing the pose.
 */
export function applyAxiomBimanualReach(
  binding: AxiomRigBinding,
  taskPhase: number | null,
  targets?: AxiomBimanualTargets,
  reachEnvelopeOverride?: number,
): AxiomActuationObservation {
  const phase = THREE.MathUtils.clamp(
    taskPhase !== null && Number.isFinite(taskPhase) ? taskPhase : 0,
    0,
    1,
  );
  const reachEnvelope =
    taskPhase === null
      ? 0
      : reachEnvelopeOverride === undefined
        ? Math.sin(phase * Math.PI)
        : THREE.MathUtils.clamp(
            Number.isFinite(reachEnvelopeOverride) ? reachEnvelopeOverride : 0,
            0,
            1,
          );
  const targetForward = THREE.MathUtils.lerp(
    AXIOM_REST_REACH[0],
    AXIOM_TASK_REACH[0],
    reachEnvelope,
  );
  const targetHeight = THREE.MathUtils.lerp(
    AXIOM_REST_REACH[1],
    AXIOM_TASK_REACH[1],
    reachEnvelope,
  );
  const leftRest = solveAxiomPlanarReach(...AXIOM_REST_REACH, 'left');
  const rightRest = solveAxiomPlanarReach(...AXIOM_REST_REACH, 'right');
  const leftSolution = solveAxiomPlanarReach(targetForward, targetHeight, 'left');
  const rightSolution = solveAxiomPlanarReach(targetForward, targetHeight, 'right');
  const leftShoulderDelta = leftSolution.shoulderRadians - leftRest.shoulderRadians;
  const rightShoulderDelta = rightSolution.shoulderRadians - rightRest.shoulderRadians;
  const leftElbowDelta = leftSolution.elbowRadians - leftRest.elbowRadians;
  const rightElbowDelta = rightSolution.elbowRadians - rightRest.elbowRadians;
  // Exact-rest-pose perturbation measurements solve each chain's asymmetric
  // authored axes into a forward command: local X supplies lift/forward motion
  // while the mirrored local Z term cancels lateral hand drift.
  const requested: Readonly<
    Record<'LeftArm' | 'RightArm' | 'LeftForeArm' | 'RightForeArm', THREE.Euler>
  > = {
    LeftArm: new THREE.Euler(-leftShoulderDelta, 0, leftShoulderDelta * 0.94),
    RightArm: new THREE.Euler(-rightShoulderDelta, 0, -rightShoulderDelta * 1.37),
    LeftForeArm: new THREE.Euler(leftElbowDelta, 0, -leftElbowDelta * 0.67),
    RightForeArm: new THREE.Euler(rightElbowDelta, 0, rightElbowDelta * 0.835),
  };
  const jointDeltas: Partial<Record<AxiomJointName, readonly [number, number, number]>> = {};
  let reachTarget: Tuple3 = [leftSolution.targetForward, leftSolution.targetHeight, 0];
  let reachErrorMeters = Math.max(leftSolution.errorMeters, rightSolution.errorMeters);
  let endEffectors: AxiomActuationObservation['endEffectors'] = null;

  if (taskPhase !== null && targets) {
    const left = optimizeAxiomArm(binding, 'left', targets.left, reachEnvelope);
    const right = optimizeAxiomArm(binding, 'right', targets.right, reachEnvelope);
    Object.assign(jointDeltas, left.jointDeltas, right.jointDeltas);
    reachTarget = tuple3(left.target.clone().add(right.target).multiplyScalar(0.5));
    reachErrorMeters = Math.max(left.errorMeters, right.errorMeters);
    endEffectors = {
      left: {
        target: tuple3(left.target),
        actual: tuple3(left.actual),
        errorMeters: left.errorMeters,
      },
      right: {
        target: tuple3(right.target),
        actual: tuple3(right.actual),
        errorMeters: right.errorMeters,
      },
    };
  } else if (taskPhase !== null) {
    for (const [name, delta] of Object.entries(requested) as [
      keyof typeof requested,
      THREE.Euler,
    ][]) {
      const clamped = clampAxiomJointDelta(name, delta);
      binding.joints[name].quaternion
        .multiply(new THREE.Quaternion().setFromEuler(clamped))
        .normalize();
      jointDeltas[name] = [clamped.x, clamped.y, clamped.z];
    }
  }

  binding.actuation.sequence += 1;
  binding.actuation.mode = taskPhase === null ? 'idle' : 'bimanual-reach';
  binding.actuation.phase = phase;
  binding.actuation.reachTarget = reachTarget;
  binding.actuation.reachErrorMeters = reachErrorMeters;
  binding.actuation.jointDeltas = jointDeltas;
  binding.actuation.endEffectors = endEffectors;
  return binding.actuation;
}

/** Adds a restrained mirrored wrist closure after arm IK has been applied. */
export function applyAxiomGraspHands(binding: AxiomRigBinding, closure: number): void {
  const amount = THREE.MathUtils.clamp(Number.isFinite(closure) ? closure : 0, 0, 1);
  if (amount <= 0) return;
  for (const [name, direction] of [
    ['LeftHand', 1],
    ['RightHand', -1],
  ] as const) {
    const rest = binding.restPose[name].quaternion;
    const requested = clampAxiomJointDelta(
      name,
      new THREE.Euler(
        THREE.MathUtils.degToRad(-8) * amount,
        THREE.MathUtils.degToRad(16) * direction * amount,
        THREE.MathUtils.degToRad(11) * direction * amount,
      ),
    );
    binding.joints[name].quaternion
      .set(rest[0], rest[1], rest[2], rest[3])
      .multiply(new THREE.Quaternion().setFromEuler(requested))
      .normalize();
    binding.actuation.jointDeltas = {
      ...binding.actuation.jointDeltas,
      [name]: [requested.x, requested.y, requested.z],
    };
  }
}
