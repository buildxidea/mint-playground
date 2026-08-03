import * as THREE from 'three';
import type { ScenarioDefinition } from '../config/catalog';
import type { InputIntent } from '../core/InputController';
import type { TaskFixtureObservation } from '../physics/PhysicsWorld';
import type { RobotTelemetry } from '../robots/RobotRuntime';
import { calculateScore, type ScoreBreakdown } from '../scoring/ScoreCalculator';
import {
  resolveScenarioTaskVerb,
  type RobotTaskSnapshot,
  type RobotTaskVerb,
} from '../tasks/RobotTaskController';
import { objectiveRequiresTaskAction } from './TrainingGuidance';

export type EpisodeStatus = 'idle' | 'running' | 'success' | 'failure' | 'timeout';

export type EpisodeObservation = {
  tick: number;
  elapsedSeconds: number;
  status: EpisodeStatus;
  objectiveIndex: number;
  objectiveCount: number;
  requiresInteraction: boolean;
  currentGoal: THREE.Vector3 | null;
  robotPosition: THREE.Vector3;
  battery: number;
  collisionCount: number;
  requiredTaskVerb: RobotTaskVerb | null;
};

export type EpisodeEvent = {
  tick: number;
  type: 'episode-start' | 'objective-complete' | 'collision' | 'success' | 'timeout' | 'reset';
  value?: number;
};

export type EpisodePhysicalTaskState = Readonly<{
  fixtures: Readonly<{
    'control-panel-east': TaskFixtureObservation | null;
    'dock-south': TaskFixtureObservation | null;
  }>;
}>;

export class TrainingEpisode {
  private status: EpisodeStatus = 'idle';
  private tick = 0;
  private elapsedSeconds = 0;
  private objectiveIndex = 1;
  private pathDistance = 0;
  private maxHorizontalDisplacementFromStart = 0;
  private readonly startPosition = new THREE.Vector3();
  private previousPosition = new THREE.Vector3();
  private previousCollisions = 0;
  private dockHoldSeconds = 0;
  private score: ScoreBreakdown | null = null;
  private readonly events: EpisodeEvent[] = [];
  private acceptedTaskSequence = 0;
  private objectiveTaskFloorSequence = 0;

  constructor(
    private readonly scenario: ScenarioDefinition,
    private readonly route: readonly THREE.Vector3[],
    private readonly requirePhysicalTaskState = false,
  ) {}

  resetEpisode(config: { seed: number; position: THREE.Vector3 }): EpisodeObservation {
    void config.seed;
    this.status = 'running';
    this.tick = 0;
    this.elapsedSeconds = 0;
    this.objectiveIndex = Math.min(1, this.route.length - 1);
    this.pathDistance = 0;
    this.maxHorizontalDisplacementFromStart = 0;
    this.startPosition.copy(config.position);
    this.previousPosition.copy(config.position);
    this.previousCollisions = 0;
    this.dockHoldSeconds = 0;
    this.score = null;
    this.events.length = 0;
    this.events.push({ tick: 0, type: 'episode-start' });
    this.acceptedTaskSequence = 0;
    this.objectiveTaskFloorSequence = 0;
    return this.getObservation(config.position, 100, 0);
  }

  getObservation(
    robotPosition = this.previousPosition,
    battery = 100,
    collisionCount = this.previousCollisions,
  ): EpisodeObservation {
    return {
      tick: this.tick,
      elapsedSeconds: this.elapsedSeconds,
      status: this.status,
      objectiveIndex: this.objectiveIndex,
      objectiveCount: this.route.length - 1,
      requiresInteraction: this.objectiveRequiresInteraction(this.objectiveIndex),
      currentGoal: this.route[this.objectiveIndex]?.clone() ?? null,
      robotPosition: robotPosition.clone(),
      battery,
      collisionCount,
      requiredTaskVerb: this.objectiveRequiresInteraction(this.objectiveIndex)
        ? this.requiredTaskVerb(this.objectiveIndex)
        : null,
    };
  }

  submitAction(action: InputIntent): void {
    // Commands are retained as an API boundary for replay and external agents,
    // but objective completion is authorized only by RobotTaskSnapshot.
    void action;
  }

  stepSimulation(
    fixedDt: number,
    telemetry: RobotTelemetry,
    taskAction?: RobotTaskSnapshot,
    physicalTaskState?: EpisodePhysicalTaskState,
  ): EpisodeObservation {
    if (this.status !== 'running') {
      return this.getObservation(telemetry.position, telemetry.battery, telemetry.collisions);
    }
    this.tick += 1;
    this.elapsedSeconds += fixedDt;
    this.pathDistance += telemetry.position.distanceTo(this.previousPosition);
    this.maxHorizontalDisplacementFromStart = Math.max(
      this.maxHorizontalDisplacementFromStart,
      Math.hypot(
        telemetry.position.x - this.startPosition.x,
        telemetry.position.z - this.startPosition.z,
      ),
    );
    this.previousPosition.copy(telemetry.position);

    if (telemetry.collisions > this.previousCollisions) {
      this.events.push({
        tick: this.tick,
        type: 'collision',
        value: telemetry.collisions,
      });
      this.previousCollisions = telemetry.collisions;
    }

    const goal = this.route[this.objectiveIndex];
    if (goal) {
      const horizontalDistance = Math.hypot(
        telemetry.position.x - goal.x,
        telemetry.position.z - goal.z,
      );
      const verticalDistance = Math.abs(telemetry.position.y - goal.y);
      const rule = this.scenario.objectiveRules?.[this.objectiveIndex - 1];
      const tolerance =
        rule?.positionTolerance ?? (this.objectiveIndex === this.route.length - 1 ? 0.82 : 1.1);
      const needsInteraction = this.objectiveRequiresInteraction(this.objectiveIndex);
      const requiredVerb = this.requiredTaskVerb(this.objectiveIndex);
      const completedTask =
        taskAction?.status === 'completed' &&
        taskAction.verb === requiredVerb &&
        taskAction.completedSequence >
          Math.max(this.acceptedTaskSequence, this.objectiveTaskFloorSequence);
      let ruleSatisfied = !needsInteraction || completedTask;
      let completionHorizontalDistance = horizontalDistance;
      if (rule?.kind === 'safe-speed') {
        ruleSatisfied = telemetry.speed <= rule.maxSpeed;
      } else if (rule?.kind === 'physical-interaction') {
        const fixture = physicalTaskState?.fixtures[rule.targetId] ?? null;
        if (this.requirePhysicalTaskState && fixture) {
          completionHorizontalDistance = fixture.horizontalDistanceMeters;
        }
        ruleSatisfied =
          completedTask &&
          (!this.requirePhysicalTaskState ||
            (fixture?.state === 'actuated' && fixture.sequence > 0));
      } else if (rule?.kind === 'precision-dock') {
        const approachStart = this.route[Math.max(0, this.objectiveIndex - 1)] ?? goal;
        const desiredYaw = Math.atan2(-(goal.x - approachStart.x), -(goal.z - approachStart.z));
        const yawError = Math.abs(
          Math.atan2(Math.sin(telemetry.yaw - desiredYaw), Math.cos(telemetry.yaw - desiredYaw)),
        );
        const dockPoseReady =
          horizontalDistance <= rule.positionTolerance &&
          verticalDistance <= 1.2 &&
          yawError <= THREE.MathUtils.degToRad(rule.yawToleranceDegrees) &&
          telemetry.speed <= rule.maxSpeed;
        this.dockHoldSeconds = dockPoseReady ? this.dockHoldSeconds + fixedDt : 0;
        ruleSatisfied = this.dockHoldSeconds >= rule.holdSeconds;
      } else if (rule?.kind === 'physical-dock') {
        const fixture = physicalTaskState?.fixtures[rule.targetId] ?? null;
        if (this.requirePhysicalTaskState && fixture) {
          completionHorizontalDistance = fixture.horizontalDistanceMeters;
        }
        const fixturePoseReady =
          fixture?.sensorOverlap === true &&
          fixture.horizontalDistanceMeters <= rule.positionTolerance &&
          fixture.yawErrorDegrees <= rule.yawToleranceDegrees &&
          telemetry.speed <= rule.maxSpeed;
        const fallbackPoseReady =
          horizontalDistance <= rule.positionTolerance && telemetry.speed <= rule.maxSpeed;
        const dockPoseReady =
          completedTask && (this.requirePhysicalTaskState ? fixturePoseReady : fallbackPoseReady);
        this.dockHoldSeconds = dockPoseReady ? this.dockHoldSeconds + fixedDt : 0;
        ruleSatisfied = this.dockHoldSeconds >= rule.holdSeconds;
      }
      if (
        completionHorizontalDistance <= tolerance &&
        verticalDistance <= (telemetry.position.y > 1 ? 2.5 : 1.2) &&
        ruleSatisfied
      ) {
        this.events.push({
          tick: this.tick,
          type: 'objective-complete',
          value: this.objectiveIndex,
        });
        this.objectiveIndex += 1;
        if (completedTask && taskAction) {
          this.acceptedTaskSequence = taskAction.completedSequence;
        }
        this.objectiveTaskFloorSequence = taskAction?.sequence ?? this.acceptedTaskSequence;
        this.dockHoldSeconds = 0;
      }
    }

    if (this.objectiveIndex >= this.route.length) {
      this.status = 'success';
      this.events.push({ tick: this.tick, type: 'success' });
      this.score = this.buildScore(telemetry, true);
    } else if (this.elapsedSeconds >= this.scenario.timeLimitSeconds) {
      this.status = 'timeout';
      this.events.push({ tick: this.tick, type: 'timeout' });
      this.score = this.buildScore(telemetry, false);
    }

    return this.getObservation(telemetry.position, telemetry.battery, telemetry.collisions);
  }

  getRewardBreakdown(): ScoreBreakdown | null {
    return this.score;
  }

  getEpisodeState(): {
    status: EpisodeStatus;
    tick: number;
    elapsedSeconds: number;
    objectiveIndex: number;
    pathDistance: number;
    maxHorizontalDisplacementFromStart: number;
    dockHoldSeconds: number;
  } {
    return {
      status: this.status,
      tick: this.tick,
      elapsedSeconds: this.elapsedSeconds,
      objectiveIndex: this.objectiveIndex,
      pathDistance: this.pathDistance,
      maxHorizontalDisplacementFromStart: this.maxHorizontalDisplacementFromStart,
      dockHoldSeconds: this.dockHoldSeconds,
    };
  }

  exportEpisodeLog(): EpisodeEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  loadReplay(events: readonly EpisodeEvent[]): void {
    this.events.length = 0;
    this.events.push(...events.map((event) => ({ ...event })));
  }

  fail(telemetry: RobotTelemetry): void {
    if (this.status !== 'running') return;
    this.status = 'failure';
    this.score = this.buildScore(telemetry, false);
  }

  private buildScore(telemetry: RobotTelemetry, success: boolean): ScoreBreakdown {
    let optimalDistance = 0;
    for (let index = 1; index < this.route.length; index += 1) {
      optimalDistance += this.route[index - 1].distanceTo(this.route[index]);
    }
    const completed = Math.max(0, this.objectiveIndex - 1);
    const objectiveAccuracy = completed / Math.max(1, this.route.length - 1);
    return calculateScore({
      success,
      elapsedSeconds: this.elapsedSeconds,
      timeLimitSeconds: this.scenario.timeLimitSeconds,
      pathDistance: this.pathDistance,
      optimalDistance,
      energyUsed: telemetry.energyUsed,
      collisions: telemetry.collisions,
      objectiveAccuracy,
    });
  }

  private objectiveRequiresInteraction(index: number): boolean {
    return objectiveRequiresTaskAction(this.scenario, index);
  }

  private requiredTaskVerb(index: number): RobotTaskVerb {
    return resolveScenarioTaskVerb(this.scenario.robotId, this.scenario.objectives[index - 1]);
  }
}
