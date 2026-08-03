import * as THREE from 'three';
import { ROBOT_DIMENSIONS_METERS, type RobotDefinition, type RobotId } from '../config/catalog';
import { ROBOT_COMPONENT_INVENTORY } from '../assets/components';
import { mintRuntimeUrl } from '../assets/mintRuntimeUrls';
import {
  MintComponentLoader,
  type MintComponentInstance,
} from '../assets/components/MintComponentRuntime';
import {
  applyAxiomBimanualReach,
  applyAxiomGraspHands,
  applyAxiomJumpPose,
  applyAxiomMobilityPosture,
  bindAxiomRig,
} from './AxiomRigContract';
import { resolveAxiomGraspMotion } from './AxiomGraspMotion';
import { resolveAxiomJumpPose } from './AxiomJumpMotion';
import { alignImportedRobotHeading, getRobotAssemblyContract } from './RobotAssemblyContract';
import type { RobotVisual, RobotVisualAnimation } from './RobotVisualFactory';

type NormalizedAnchor = readonly [number, number, number];
type Position = readonly [number, number, number];
type Rotation = readonly [number, number, number];

type ProductionAssembly = Omit<RobotVisual, 'source' | 'dispose'> & {
  root: THREE.Group;
  cleanup?: () => void;
};

const CENTER: NormalizedAnchor = [0.5, 0.5, 0.5];
const TOP: NormalizedAnchor = [0.5, 1, 0.5];
const BOTTOM: NormalizedAnchor = [0.5, 0, 0.5];
const LEFT_CENTER: NormalizedAnchor = [0, 0.5, 0.5];

/**
 * Builds the render-only production assemblies. Physics envelopes, simulation
 * transforms, telemetry, navigation, and replay remain owned by RobotRuntime.
 */
export class ProductionRobotVisualFactory {
  async create(definition: RobotDefinition): Promise<RobotVisual> {
    const loader = new MintComponentLoader();
    let status: ReturnType<typeof createStatusBeacon> | null = null;

    try {
      const assembly = await this.createById(definition.id, loader);
      status = createStatusBeacon(definition.accent);
      status.root.position.copy(statusPosition(definition.id));
      assembly.body.add(status.root);

      assembly.root.name = `production-mint:${definition.id}`;
      assembly.root.userData.productionAsset = true;
      assembly.root.userData.assetSource = 'mint';
      assembly.root.userData.robotId = definition.id;
      assembly.root.userData.forward = '-Z';
      assembly.root.userData.expectedVisibleComponentCount = expectedVisibleComponentCount(
        definition.id,
      );
      configureMeshes(assembly.root);
      alignImportedRobotHeading(assembly.body, definition.id);
      calibrateProductionRobotEnvelope(assembly.root, assembly.body, definition.id);
      assembly.root.userData.assemblyContract = {
        schemaVersion: 1,
        canonicalForward: '-Z',
        neutralPose: getRobotAssemblyContract(definition.id).neutralPose,
      };

      let disposed = false;
      return {
        ...assembly,
        statusMaterials: [status.material],
        source: 'production',
        dispose: () => {
          if (disposed) return;
          disposed = true;
          assembly.root.removeFromParent();
          assembly.cleanup?.();
          loader.dispose();
          status?.geometry.dispose();
          status?.material.dispose();
        },
      };
    } catch (error) {
      loader.dispose();
      status?.geometry.dispose();
      status?.material.dispose();
      throw error;
    }
  }

  private createById(id: RobotId, loader: MintComponentLoader): Promise<ProductionAssembly> {
    switch (id) {
      case 'axiom-h1':
        return this.createAxiom(loader);
      case 'quadrant-q4':
        return this.createQuadrant(loader);
      case 'forge-t7':
        return this.createForge(loader);
      case 'swift-w2':
        return this.createSwift(loader);
      case 'kestrel-d5':
        return this.createKestrel(loader);
    }
  }

  private async createAxiom(loader: MintComponentLoader): Promise<ProductionAssembly> {
    const [model, idleSource, walkSource] = await Promise.all([
      load(loader, 'axiom-h1-rigged', mintRuntimeUrl('robot/axiom-h1/rigged')),
      load(loader, 'axiom-h1-idle', mintRuntimeUrl('animation/axiom-h1/idle')),
      load(loader, 'axiom-h1-walk', mintRuntimeUrl('animation/axiom-h1/walk')),
    ]);
    const root = group('axiom-h1:root');
    const body = group('axiom-h1:body');
    const sensor = group('axiom-h1:sensor-yaw');
    root.add(body);
    body.add(sensor);
    sensor.position.set(0, 1.58, -0.13);
    mount(model, body, {
      name: 'axiom-h1:rigged-model',
      position: [0, 0, 0],
      targetLongestExtent: 1.78,
      anchor: BOTTOM,
      rotation: [0, Math.PI, 0],
    });

    const mixer = new THREE.AnimationMixer(model.root);
    const idleClip = idleSource.animations[0] ?? model.animations[0];
    const walkClip = walkSource.animations[0] ?? model.animations[1];
    const idleAction = idleClip ? mixer.clipAction(idleClip) : null;
    const walkAction = walkClip ? mixer.clipAction(walkClip) : null;
    idleAction?.play();
    mixer.update(0);
    let walking = false;

    const articulation = bindAxiomRig(model.root);
    const carrySocket = socket(body, 'axiom-h1:carry:chest-bimanual-center', [0, 1, -0.82]);
    const leftReachTargetLocal = new THREE.Vector3(-0.19, 1.05, -0.56);
    const rightReachTargetLocal = new THREE.Vector3(0.28, 1, -0.56);
    const bimanualTargets = {
      left: new THREE.Vector3(),
      right: new THREE.Vector3(),
    };
    const graspCenter = new THREE.Vector3();
    const targetTowardRobot = new THREE.Vector3();
    const robotWorldPosition = new THREE.Vector3();
    const robotWorldQuaternion = new THREE.Quaternion();
    const graspSide = new THREE.Vector3();

    const animate = ({
      fixedDt,
      speedRatio,
      taskActionActive,
      taskActionPhase,
      taskActionVerb,
      mobilityPosture,
      jump,
      taskTargetWorld,
      carry,
    }: RobotVisualAnimation): void => {
      const jumpPose = resolveAxiomJumpPose(jump);
      const shouldWalk = !jump.active && speedRatio > 0.06;
      if (shouldWalk !== walking && idleAction && walkAction) {
        if (shouldWalk) {
          walkAction.reset().play();
          idleAction.crossFadeTo(walkAction, 0.22, true);
        } else {
          idleAction.reset().play();
          walkAction.crossFadeTo(idleAction, jump.active ? 0.08 : 0.28, true);
        }
        walking = shouldWalk;
      }
      mixer.timeScale = jump.active ? 1 : THREE.MathUtils.clamp(0.72 + speedRatio * 0.85, 0.72, 2);
      mixer.update(fixedDt);
      const sensorTask = taskActionVerb === 'scan' || taskActionVerb === 'inspect';
      const manipulationTask =
        carry !== null ||
        (taskActionActive &&
          !sensorTask &&
          taskActionVerb !== 'dock' &&
          taskActionVerb !== 'stabilize');
      const graspTask =
        manipulationTask && (taskActionVerb === 'grasp' || taskActionVerb === 'release');
      const graspMotion = graspTask
        ? resolveAxiomGraspMotion(taskActionPhase, taskActionVerb === 'release')
        : null;
      if (manipulationTask) {
        if (taskTargetWorld && graspTask) {
          root.getWorldPosition(robotWorldPosition);
          targetTowardRobot.copy(robotWorldPosition).sub(taskTargetWorld).setY(0);
          if (targetTowardRobot.lengthSq() > 1e-6) {
            targetTowardRobot.normalize().multiplyScalar(carry ? 0.02 : 0.28);
          }
          graspCenter.copy(taskTargetWorld).add(targetTowardRobot);
          graspCenter.y += 0.32 + (graspMotion?.lift ?? 0) * 0.04;
          root.getWorldQuaternion(robotWorldQuaternion);
          graspSide
            .set(1, 0, 0)
            .applyQuaternion(robotWorldQuaternion)
            .multiplyScalar(carry ? carry.gripSpanMeters * 0.48 : 0.14);
          bimanualTargets.left.copy(graspCenter).addScaledVector(graspSide, -1);
          bimanualTargets.right.copy(graspCenter).add(graspSide);
        } else {
          bimanualTargets.left.copy(leftReachTargetLocal);
          bimanualTargets.right.copy(rightReachTargetLocal);
          body.localToWorld(bimanualTargets.left);
          body.localToWorld(bimanualTargets.right);
        }
      }
      applyAxiomBimanualReach(
        articulation,
        manipulationTask ? (carry ? carry.progress : taskActionPhase) : null,
        manipulationTask ? bimanualTargets : undefined,
        carry?.reach ?? graspMotion?.reach,
      );
      if (carry || graspMotion) {
        applyAxiomGraspHands(articulation, carry?.gripClosure ?? graspMotion?.handClosure ?? 0);
      }
      applyAxiomMobilityPosture(articulation, mobilityPosture);
      const jumpJointDeltas = applyAxiomJumpPose(articulation, jumpPose, !manipulationTask);
      if (taskActionActive && sensorTask) {
        articulation.joints.neck.rotation.y += Math.sin(taskActionPhase * Math.PI * 4) * 0.52;
        articulation.joints.Head.rotation.x +=
          -0.08 + Math.sin(taskActionPhase * Math.PI * 2) * 0.14;
      }
      body.position.y =
        (taskActionActive && (taskActionVerb === 'dock' || taskActionVerb === 'stabilize')
          ? -Math.sin(taskActionPhase * Math.PI) * 0.06
          : 0) + jumpPose.bodyOffsetY;
      root.userData.jumpAnimation = {
        ...jump,
        profile: 'axiom-h1:articulated-jump-v1',
        articulatedJoints: Object.keys(jumpJointDeltas).length,
      };
      recordTaskAnimation(
        root,
        taskActionActive || carry !== null,
        taskActionVerb,
        taskActionPhase,
        sensorTask
          ? 'head-sensor-sweep'
          : manipulationTask
            ? carry
              ? `carry-${carry.mode}-${carry.stage}`
              : graspMotion
                ? `bimanual-grasp-${graspMotion.stage}`
                : 'bimanual-task-reach'
            : 'stability-posture',
      );
    };
    const cleanup = (): void => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model.root);
    };

    return {
      root,
      body,
      sensor,
      locomotionParts: [],
      manipulatorParts: [],
      carrySocket,
      statusMaterials: [],
      articulation,
      animate,
      cleanup,
    };
  }

  private async createQuadrant(loader: MintComponentLoader): Promise<ProductionAssembly> {
    const inventory = ROBOT_COMPONENT_INVENTORY['quadrant-q4'];
    const [
      centralBody,
      frontLeftUpper,
      frontLeftLower,
      frontRightUpper,
      frontRightLower,
      rearLeftUpper,
      rearLeftLower,
      rearRightUpper,
      rearRightLower,
    ] = await Promise.all([
      loadAsset(loader, inventory['central-body']),
      loadAsset(loader, inventory['front-left-upper-leg']),
      loadAsset(loader, inventory['front-left-lower-leg-foot']),
      loadAsset(loader, inventory['front-right-upper-leg']),
      loadAsset(loader, inventory['front-right-lower-leg-foot']),
      loadAsset(loader, inventory['rear-left-upper-leg']),
      loadAsset(loader, inventory['rear-left-lower-leg-foot']),
      loadAsset(loader, inventory['rear-right-upper-leg']),
      loadAsset(loader, inventory['rear-right-lower-leg-foot']),
    ]);

    const root = group('quadrant-q4:root');
    const body = group('quadrant-q4:body');
    const sensor = group('quadrant-q4:sensor-yaw');
    root.add(body);
    body.add(sensor);
    sensor.position.set(0.24, 0.92, -0.12);
    mount(centralBody, body, {
      name: 'quadrant-q4:central-body',
      position: [0, 0.72, 0],
      targetLongestExtent: 1.06,
      anchor: CENTER,
    });

    const locomotionParts: THREE.Object3D[] = [];
    const legs = [
      {
        name: 'front-left',
        upper: frontLeftUpper,
        lower: frontLeftLower,
        position: [-0.43, 0.68, -0.25] as Position,
        upperAnchor: TOP,
        upperRotation: [0, 0, 0] as Rotation,
        phase: 0,
      },
      {
        name: 'front-right',
        upper: frontRightUpper,
        lower: frontRightLower,
        position: [0.43, 0.68, -0.25] as Position,
        upperAnchor: [0, 0.5, 0.5] as NormalizedAnchor,
        upperRotation: [0, 0, -Math.PI / 2] as Rotation,
        phase: Math.PI,
      },
      {
        name: 'rear-left',
        upper: rearLeftUpper,
        lower: rearLeftLower,
        position: [-0.43, 0.68, 0.25] as Position,
        upperAnchor: [0, 0.5, 0.5] as NormalizedAnchor,
        upperRotation: [0, 0, -Math.PI / 2] as Rotation,
        phase: Math.PI,
      },
      {
        name: 'rear-right',
        upper: rearRightUpper,
        lower: rearRightLower,
        position: [0.43, 0.68, 0.25] as Position,
        upperAnchor: [0.5, 0.5, 0] as NormalizedAnchor,
        upperRotation: [Math.PI / 2, 0, 0] as Rotation,
        phase: 0,
      },
    ];
    const gaitJoints: { hip: THREE.Group; knee: THREE.Group; phase: number }[] = [];

    for (const leg of legs) {
      const hip = group(`quadrant-q4:${leg.name}:hip-pitch`);
      const knee = group(`quadrant-q4:${leg.name}:knee-pitch`);
      hip.position.set(...leg.position);
      knee.position.set(0, -0.32, 0);
      body.add(hip);
      hip.add(knee);
      mount(leg.upper, hip, {
        name: `quadrant-q4:${leg.name}:upper-leg`,
        targetLongestExtent: 0.38,
        anchor: leg.upperAnchor,
        rotation: leg.upperRotation,
      });
      mount(leg.lower, knee, {
        name: `quadrant-q4:${leg.name}:lower-leg-foot`,
        targetLongestExtent: 0.4,
        anchor: TOP,
      });
      locomotionParts.push(hip, knee);
      gaitJoints.push({ hip, knee, phase: leg.phase });
    }
    for (const { hip, knee } of gaitJoints) {
      hip.rotation.z = 0;
      knee.rotation.z = -0.34;
    }
    const carrySocket = socket(body, 'quadrant-q4:carry:dorsal-payload-rack', [0, 0.82, 0]);

    const animate = ({
      animationTime,
      speedRatio,
      taskActionActive,
      taskActionPhase,
      taskActionVerb,
      carry,
    }: RobotVisualAnimation): void => {
      for (const { hip, knee, phase } of gaitJoints) {
        const cycle = Math.sin(animationTime + phase) * speedRatio;
        hip.rotation.z = cycle * 0.34;
        knee.rotation.z = -0.34 + Math.max(0, -cycle) * 0.42;
      }
      const sensorTask = taskActionVerb === 'scan' || taskActionVerb === 'inspect';
      const braceTask = taskActionVerb === 'stabilize' || taskActionVerb === 'dock';
      body.position.y =
        Math.sin(animationTime * 2) * speedRatio * 0.012 -
        (carry
          ? (1 - carry.lift) * 0.12 + carry.loadScale * 0.025
          : taskActionActive && braceTask
            ? Math.sin(taskActionPhase * Math.PI) * 0.1
            : 0);
      sensor.rotation.y =
        taskActionActive && sensorTask
          ? Math.sin(taskActionPhase * Math.PI * 4) * 0.72
          : Math.sin(animationTime * 0.23) * 0.38;
      sensor.rotation.x =
        taskActionActive && !sensorTask ? Math.sin(taskActionPhase * Math.PI * 2) * 0.16 : 0;
      recordTaskAnimation(
        root,
        taskActionActive || carry !== null,
        taskActionVerb,
        taskActionPhase,
        carry
          ? `carry-${carry.mode}-${carry.stage}`
          : sensorTask
            ? 'inspection-mast-sweep'
            : braceTask
              ? 'terrain-brace'
              : 'mast-task-nod',
      );
    };

    return {
      root,
      body,
      sensor,
      locomotionParts,
      manipulatorParts: [sensor],
      carrySocket,
      statusMaterials: [],
      animate,
    };
  }

  private async createForge(loader: MintComponentLoader): Promise<ProductionAssembly> {
    const inventory = ROBOT_COMPONENT_INVENTORY['forge-t7'];
    const [base, upperStructure, boom, stick, gripper] = await Promise.all([
      loadAsset(loader, inventory['tracked-lower-chassis']),
      loadAsset(loader, inventory['rotating-upper-structure']),
      loadAsset(loader, inventory['main-boom']),
      loadAsset(loader, inventory.stick),
      loadAsset(loader, inventory['quick-change-gripper']),
    ]);
    const root = group('forge-t7:root');
    const body = group('forge-t7:body');
    const upperYaw = group('forge-t7:upper-yaw');
    const boomPitch = group('forge-t7:boom-pitch');
    const stickPitch = group('forge-t7:stick-pitch');
    const toolPitch = group('forge-t7:tool-pitch');
    const sensor = group('forge-t7:sensor-yaw');
    root.add(body);
    body.add(upperYaw);
    upperYaw.add(boomPitch, sensor);
    boomPitch.add(stickPitch);
    stickPitch.add(toolPitch);
    upperYaw.position.set(0, 0.67, 0.05);
    boomPitch.position.set(-0.23, 0.29, 0.16);
    stickPitch.position.set(0, 0.48, 0);
    toolPitch.position.set(0, 0.42, -0.02);
    sensor.position.set(0.31, 0.52, -0.13);

    mount(base, body, {
      name: 'forge-t7:tracked-lower-chassis',
      position: [0, 0.34, 0],
      targetLongestExtent: 1.76,
      anchor: CENTER,
    });
    mount(upperStructure, upperYaw, {
      name: 'forge-t7:rotating-upper-structure',
      position: [0, 0.13, 0],
      targetLongestExtent: 0.92,
      anchor: CENTER,
      rotation: [0, Math.PI / 2, 0],
    });
    mount(boom, boomPitch, {
      name: 'forge-t7:main-boom',
      targetLongestExtent: 0.84,
      anchor: LEFT_CENTER,
      rotation: [0, 0, Math.PI / 2],
    });
    mount(stick, stickPitch, {
      name: 'forge-t7:stick',
      targetLongestExtent: 0.7,
      anchor: LEFT_CENTER,
      rotation: [0, 0, Math.PI / 2],
    });
    mount(gripper, toolPitch, {
      name: 'forge-t7:quick-change-gripper',
      targetLongestExtent: 0.44,
      anchor: LEFT_CENTER,
      rotation: [0, 0, Math.PI / 2],
    });
    boomPitch.rotation.x = -0.46;
    stickPitch.rotation.x = 0.88;
    toolPitch.rotation.x = -0.34;
    const carrySocket = socket(toolPitch, 'forge-t7:carry:quick-change-gripper', [0, 0.34, 0]);

    const animate = ({
      animationTime,
      taskActionActive,
      taskActionPhase,
      taskActionVerb,
      carry,
    }: RobotVisualAnimation): void => {
      const work = carry
        ? THREE.MathUtils.lerp(0.72, 0.5, carry.loadScale) * carry.reach
        : taskActionActive
          ? Math.sin(taskActionPhase * Math.PI)
          : 0;
      const sensorTask = taskActionVerb === 'scan' || taskActionVerb === 'inspect';
      const rotateTask = taskActionVerb === 'turn';
      const clearTask = taskActionVerb === 'clear';
      upperYaw.rotation.y =
        Math.sin(animationTime * 0.12) * 0.12 +
        (taskActionActive && (rotateTask || clearTask)
          ? Math.sin(taskActionPhase * Math.PI * 2) * (rotateTask ? 0.72 : 0.28)
          : 0);
      boomPitch.rotation.x =
        -0.46 + Math.sin(animationTime * 0.16) * 0.04 - (sensorTask ? 0 : work * 0.36);
      stickPitch.rotation.x =
        0.88 + Math.sin(animationTime * 0.13) * 0.035 + (sensorTask ? 0 : work * 0.58);
      toolPitch.rotation.x = -0.34 - (sensorTask ? 0 : work * 0.44);
      sensor.rotation.y =
        taskActionActive && sensorTask
          ? Math.sin(taskActionPhase * Math.PI * 4) * 0.68
          : Math.sin(animationTime * 0.23) * 0.38;
      recordTaskAnimation(
        root,
        taskActionActive || carry !== null,
        taskActionVerb,
        taskActionPhase,
        carry
          ? `carry-${carry.mode}-${carry.stage}`
          : sensorTask
            ? 'mast-sensor-sweep'
            : rotateTask
              ? 'upper-structure-rotate'
              : clearTask
                ? 'barrier-push'
                : 'arm-tool-cycle',
      );
    };

    return {
      root,
      body,
      sensor,
      locomotionParts: [],
      manipulatorParts: [upperYaw, boomPitch, stickPitch, toolPitch],
      carrySocket,
      statusMaterials: [],
      animate,
    };
  }

  private async createSwift(loader: MintComponentLoader): Promise<ProductionAssembly> {
    const inventory = ROBOT_COMPONENT_INVENTORY['swift-w2'];
    const [base, mast, torso, leftUpper, leftForearm, rightUpper, rightForearm] = await Promise.all(
      [
        loadAsset(loader, inventory['holonomic-base']),
        loadAsset(loader, inventory['telescoping-mast']),
        loadAsset(loader, inventory['torso-cargo']),
        loadAsset(loader, inventory['left-upper-arm']),
        loadAsset(loader, inventory['left-forearm-wrist-tool']),
        loadAsset(loader, inventory['right-upper-arm']),
        loadAsset(loader, inventory['right-forearm-wrist-tool']),
      ],
    );
    const root = group('swift-w2:root');
    const body = group('swift-w2:body');
    const mastLift = group('swift-w2:mast-lift');
    const torsoMount = group('swift-w2:torso-mount');
    const leftShoulder = group('swift-w2:left-shoulder-pitch');
    const leftElbow = group('swift-w2:left-elbow-pitch');
    const rightShoulder = group('swift-w2:right-shoulder-pitch');
    const rightElbow = group('swift-w2:right-elbow-pitch');
    const sensor = group('swift-w2:sensor-yaw');
    root.add(body);
    body.add(mastLift);
    mastLift.add(torsoMount);
    torsoMount.add(leftShoulder, rightShoulder, sensor);
    leftShoulder.add(leftElbow);
    rightShoulder.add(rightElbow);
    mastLift.position.set(0, 0.43, 0);
    torsoMount.position.set(0, 0.63, 0);
    leftShoulder.position.set(-0.32, 0.28, 0);
    rightShoulder.position.set(0.32, 0.28, 0);
    leftElbow.position.set(0, -0.37, 0);
    rightElbow.position.set(0, -0.37, 0);
    sensor.position.set(0, 0.34, -0.1);

    mount(base, body, {
      name: 'swift-w2:holonomic-base',
      position: [0, 0.25, 0],
      targetLongestExtent: 0.8,
      anchor: CENTER,
    });
    mount(mast, mastLift, {
      name: 'swift-w2:telescoping-mast',
      targetLongestExtent: 0.67,
      anchor: BOTTOM,
    });
    mount(torso, torsoMount, {
      name: 'swift-w2:torso-cargo',
      targetLongestExtent: 0.55,
      anchor: CENTER,
    });
    mount(leftUpper, leftShoulder, {
      name: 'swift-w2:left-upper-arm',
      targetLongestExtent: 0.42,
      anchor: TOP,
    });
    mount(leftForearm, leftElbow, {
      name: 'swift-w2:left-forearm-wrist-tool',
      targetLongestExtent: 0.39,
      anchor: TOP,
    });
    mount(rightUpper, rightShoulder, {
      name: 'swift-w2:right-upper-arm',
      targetLongestExtent: 0.42,
      anchor: TOP,
    });
    mount(rightForearm, rightElbow, {
      name: 'swift-w2:right-forearm-wrist-tool',
      targetLongestExtent: 0.39,
      anchor: TOP,
    });
    leftElbow.rotation.x = -0.18;
    rightElbow.rotation.x = -0.18;
    const carrySocket = socket(
      torsoMount,
      'swift-w2:carry:dual-arm-cradle-center',
      [0, -0.08, 0.46],
    );

    const animate = ({
      animationTime,
      speedRatio,
      taskActionActive,
      taskActionPhase,
      taskActionVerb,
      carry,
    }: RobotVisualAnimation): void => {
      const handle = carry
        ? THREE.MathUtils.lerp(0.72, 0.9, carry.gripClosure)
        : taskActionActive
          ? Math.sin(taskActionPhase * Math.PI)
          : 0;
      const sensorTask = taskActionVerb === 'scan' || taskActionVerb === 'inspect';
      const handoffTask = taskActionVerb === 'handoff' || taskActionVerb === 'release';
      mastLift.position.y =
        0.43 + Math.sin(animationTime * 0.18) * 0.012 + (sensorTask ? 0 : handle * 0.1);
      const asymmetric = handoffTask ? 0.36 : 0;
      leftShoulder.rotation.x =
        Math.sin(animationTime * 0.32) * 0.07 - (sensorTask ? 0 : handle * (0.82 + asymmetric));
      rightShoulder.rotation.x =
        Math.sin(animationTime * 0.32 + Math.PI) * 0.07 -
        (sensorTask ? 0 : handle * (0.82 - asymmetric));
      leftElbow.rotation.x = -0.18 + speedRatio * 0.025 - (sensorTask ? 0 : handle * 0.64);
      rightElbow.rotation.x =
        -0.18 + speedRatio * 0.025 - (sensorTask ? 0 : handle * (handoffTask ? 0.28 : 0.64));
      sensor.rotation.y =
        taskActionActive && sensorTask
          ? Math.sin(taskActionPhase * Math.PI * 4) * 0.72
          : Math.sin(animationTime * 0.23) * 0.38;
      recordTaskAnimation(
        root,
        taskActionActive || carry !== null,
        taskActionVerb,
        taskActionPhase,
        carry
          ? `carry-${carry.mode}-${carry.stage}`
          : sensorTask
            ? 'inventory-sensor-sweep'
            : handoffTask
              ? 'asymmetric-handoff'
              : 'dual-arm-task',
      );
    };

    return {
      root,
      body,
      sensor,
      locomotionParts: [],
      manipulatorParts: [leftShoulder, leftElbow, rightShoulder, rightElbow],
      carrySocket,
      statusMaterials: [],
      animate,
    };
  }

  private async createKestrel(loader: MintComponentLoader): Promise<ProductionAssembly> {
    const inventory = ROBOT_COMPONENT_INVENTORY['kestrel-d5'];
    const [chassis, ductPrimary, rotorPrimary, gimbal] = await Promise.all([
      loadAsset(loader, inventory['central-chassis']),
      loadAsset(loader, inventory['duct-housing']),
      loadAsset(loader, inventory['five-blade-rotor']),
      loadAsset(loader, inventory['camera-gimbal']),
    ]);
    const ducts = [
      ductPrimary,
      ductPrimary.createSharedInstance({ name: 'kestrel-d5:duct-2' }),
      ductPrimary.createSharedInstance({ name: 'kestrel-d5:duct-3' }),
      ductPrimary.createSharedInstance({ name: 'kestrel-d5:duct-4' }),
    ];
    const rotors = [
      rotorPrimary,
      rotorPrimary.createSharedInstance({ name: 'kestrel-d5:rotor-2' }),
      rotorPrimary.createSharedInstance({ name: 'kestrel-d5:rotor-3' }),
      rotorPrimary.createSharedInstance({ name: 'kestrel-d5:rotor-4' }),
    ];
    const root = group('kestrel-d5:root');
    const body = group('kestrel-d5:body-tilt');
    const gimbalYaw = group('kestrel-d5:gimbal-yaw');
    const sensor = group('kestrel-d5:gimbal-pitch');
    root.add(body);
    body.add(gimbalYaw);
    gimbalYaw.add(sensor);
    gimbalYaw.position.set(0, 0.74, -0.25);

    mount(chassis, body, {
      name: 'kestrel-d5:central-chassis',
      position: [0, 0.9, 0],
      targetLongestExtent: 0.62,
      anchor: CENTER,
    });
    mount(gimbal, sensor, {
      name: 'kestrel-d5:camera-gimbal',
      targetLongestExtent: 0.24,
      anchor: CENTER,
    });

    const rotorJoints: THREE.Group[] = [];
    const positions: Position[] = [
      [-0.38, 0.91, -0.33],
      [0.38, 0.91, -0.33],
      [-0.38, 0.91, 0.33],
      [0.38, 0.91, 0.33],
    ];
    for (let index = 0; index < positions.length; index += 1) {
      const ductMount = group(`kestrel-d5:duct-${index + 1}-mount`);
      const rotorSpin = group(`kestrel-d5:rotor-${index + 1}-spin`);
      ductMount.position.set(...positions[index]);
      body.add(ductMount);
      ductMount.add(rotorSpin);
      mount(ducts[index], ductMount, {
        name: `kestrel-d5:duct-${index + 1}`,
        targetLongestExtent: 0.34,
        anchor: CENTER,
        rotation: [Math.PI / 2, 0, 0],
      });
      mount(rotors[index], rotorSpin, {
        name: `kestrel-d5:rotor-${index + 1}`,
        targetLongestExtent: 0.28,
        anchor: CENTER,
        rotation: [Math.PI / 2, 0, 0],
      });
      rotorJoints.push(rotorSpin);
    }
    const carrySocket = socket(body, 'kestrel-d5:carry:underslung-payload-hook', [0, 0.2, 0]);

    const animate = ({
      fixedDt,
      animationTime,
      speedRatio,
      command,
      flight,
      taskActionActive,
      taskActionPhase,
      taskActionVerb,
      carry,
    }: RobotVisualAnimation): void => {
      for (const rotor of rotorJoints) {
        rotor.rotation.y += fixedDt * (18 + speedRatio * 14 + (flight?.thrustRatio ?? 0.58) * 18);
      }
      body.rotation.z = flight?.roll ?? -command.translation.x * 0.15;
      body.rotation.x = flight?.pitch ?? command.translation.z * 0.1;
      const sensorTask = taskActionVerb === 'scan' || taskActionVerb === 'inspect';
      const payloadTask =
        taskActionVerb === 'grasp' || taskActionVerb === 'release' || taskActionVerb === 'handoff';
      const dockTask = taskActionVerb === 'dock';
      gimbalYaw.rotation.y =
        taskActionActive && sensorTask
          ? Math.sin(taskActionPhase * Math.PI * 4) * 0.95
          : Math.sin(animationTime * 0.23) * 0.38;
      sensor.rotation.x =
        taskActionActive && sensorTask
          ? -0.18 - Math.sin(taskActionPhase * Math.PI * 2) * 0.3
          : Math.sin(animationTime * 0.17) * 0.12 - (flight?.pitch ?? 0) * 0.42;
      gimbalYaw.rotation.z = -(flight?.roll ?? 0) * 0.38;
      body.position.y = carry
        ? -(1 - carry.lift) * 0.1 - carry.loadScale * 0.035
        : taskActionActive && (payloadTask || dockTask)
          ? -Math.sin(taskActionPhase * Math.PI) * (dockTask ? 0.12 : 0.08)
          : 0;
      recordTaskAnimation(
        root,
        taskActionActive || carry !== null,
        taskActionVerb,
        taskActionPhase,
        carry
          ? `carry-${carry.mode}-${carry.stage}`
          : sensorTask
            ? 'gimbal-scan'
            : payloadTask
              ? 'payload-hook-cycle'
              : 'precision-hover',
      );
    };

    return {
      root,
      body,
      sensor,
      locomotionParts: rotorJoints,
      manipulatorParts: [gimbalYaw, sensor],
      carrySocket,
      statusMaterials: [],
      animate,
    };
  }
}

export function calibrateProductionRobotEnvelope(
  root: THREE.Group,
  body: THREE.Object3D,
  robotId: RobotId,
): void {
  root.updateMatrixWorld(true);
  const before = new THREE.Box3().setFromObject(body);
  const size = before.getSize(new THREE.Vector3());
  const target = new THREE.Vector3(...ROBOT_DIMENSIONS_METERS[robotId]);
  const contract = getRobotAssemblyContract(robotId);
  if (
    before.isEmpty() ||
    ![...size.toArray(), ...target.toArray()].every(Number.isFinite) ||
    Math.min(size.x, size.y, size.z) <= 0
  ) {
    throw new Error(`Production ${robotId} assembly has no measurable envelope`);
  }

  const calibrationAxisIndex =
    contract.calibrationAxis === 'width' ? 0 : contract.calibrationAxis === 'height' ? 1 : 2;
  const uniformScale =
    target.getComponent(calibrationAxisIndex) / size.getComponent(calibrationAxisIndex);
  const center = before.getCenter(new THREE.Vector3());
  const calibration = new THREE.Group();
  calibration.name = `${robotId}:metric-envelope`;
  root.add(calibration);
  calibration.add(body);
  calibration.scale.setScalar(uniformScale);
  calibration.position.set(
    -center.x * uniformScale,
    -before.min.y * uniformScale,
    -center.z * uniformScale,
  );
  root.updateMatrixWorld(true);

  const after = new THREE.Box3().setFromObject(body);
  const calibratedSize = after.getSize(new THREE.Vector3());
  const epsilon = 0.015;
  if (
    Math.abs(
      calibratedSize.getComponent(calibrationAxisIndex) - target.getComponent(calibrationAxisIndex),
    ) > epsilon
  ) {
    throw new Error(`Production ${robotId} assembly failed its reference-axis calibration`);
  }
  root.userData.metricEnvelope = {
    schemaVersion: 1,
    units: 'meters',
    target: target.toArray(),
    measuredBefore: size.toArray(),
    measuredAfter: calibratedSize.toArray(),
    uniformScale,
    calibrationAxis: contract.calibrationAxis,
  };
}

type MountOptions = Readonly<{
  name: string;
  targetLongestExtent: number;
  position?: Position;
  rotation?: Rotation;
  anchor?: NormalizedAnchor;
}>;

function mount(
  instance: MintComponentInstance,
  parent: THREE.Object3D,
  {
    name,
    targetLongestExtent,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    anchor = CENTER,
  }: MountOptions,
): void {
  const bounds = instance.bounds.corrected;
  const size = bounds.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= 0) {
    throw new Error(`Cannot mount ${instance.assetId}; corrected bounds are empty`);
  }
  const pivot = new THREE.Vector3(
    THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, anchor[0]),
    THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, anchor[1]),
    THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, anchor[2]),
  );
  instance.root.name = name;
  instance.root.position.set(...position);
  instance.root.rotation.set(...rotation);
  instance.root.scale.setScalar(targetLongestExtent / longest);
  instance.correction.position.copy(pivot).multiplyScalar(-1);
  instance.root.userData.articulatedMintComponent = true;
  parent.add(instance.root);
}

function group(name: string): THREE.Group {
  const result = new THREE.Group();
  result.name = name;
  return result;
}

function socket(parent: THREE.Object3D, name: string, position: Position): THREE.Group {
  const result = group(name);
  result.position.set(...position);
  result.userData.carrySocket = true;
  parent.add(result);
  return result;
}

async function loadAsset(
  loader: MintComponentLoader,
  asset: {
    role: string;
    publicUrl: string;
  },
): Promise<MintComponentInstance> {
  return load(loader, asset.role, asset.publicUrl);
}

async function load(
  loader: MintComponentLoader,
  assetId: string,
  url: string,
): Promise<MintComponentInstance> {
  return loader.load({
    assetId,
    url,
    name: `mint-component:${assetId}`,
  });
}

function configureMeshes(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
  });
}

function createStatusBeacon(accent: string): {
  root: THREE.Mesh;
  geometry: THREE.SphereGeometry;
  material: THREE.MeshStandardMaterial;
} {
  const geometry = new THREE.SphereGeometry(0.035, 12, 8);
  const material = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 2.2,
    roughness: 0.28,
  });
  const root = new THREE.Mesh(geometry, material);
  root.name = 'status-beacon';
  return { root, geometry, material };
}

function statusPosition(id: RobotId): THREE.Vector3 {
  switch (id) {
    case 'axiom-h1':
      return new THREE.Vector3(0, 1.32, -0.16);
    case 'quadrant-q4':
      return new THREE.Vector3(-0.2, 0.9, -0.24);
    case 'forge-t7':
      return new THREE.Vector3(0, 0.82, -0.5);
    case 'swift-w2':
      return new THREE.Vector3(0, 1.33, -0.24);
    case 'kestrel-d5':
      return new THREE.Vector3(0, 0.98, -0.27);
  }
}

function expectedVisibleComponentCount(id: RobotId): number {
  switch (id) {
    case 'axiom-h1':
      return 1;
    case 'quadrant-q4':
      return 9;
    case 'forge-t7':
      return 5;
    case 'swift-w2':
      return 7;
    case 'kestrel-d5':
      return 10;
  }
}

function recordTaskAnimation(
  root: THREE.Group,
  active: boolean,
  verb: RobotVisualAnimation['taskActionVerb'],
  phase: number,
  profile: string,
): void {
  root.userData.taskAnimation = { active, verb, phase, profile };
}
