import * as THREE from 'three';
import type { InputController } from '../core/InputController';
import type { ObjectiveState } from '../game/types';
import type { FacilityWorld } from '../world/FacilityWorld';

export type MissionEvent =
  | { type: 'checkpoint'; id: 1 | 2; segment: 1 | 2; position: THREE.Vector3 }
  | { type: 'array-disabled' }
  | { type: 'intel-retrieved' }
  | { type: 'complete' };

export type MissionSnapshot = {
  objectiveIndex: number;
  checkpointId: 0 | 1 | 2;
  interactionProgress: number;
};

const OBJECTIVES: Omit<ObjectiveState, 'progress' | 'completed'>[] = [
  {
    id: 'infiltrate',
    label: 'Infiltrate Site Nadir-12',
    detail: 'Pass the security checkpoint and descend through service access.',
  },
  {
    id: 'disable',
    label: 'Disable the Eidolon array',
    detail: 'Hold E at the communications control terminal.',
  },
  {
    id: 'retrieve',
    label: 'Retrieve the Echo Ledger',
    detail: 'Secure the encrypted archive from the east console.',
  },
  {
    id: 'extract',
    label: 'Reach extraction',
    detail: 'Cross the generator court and secure the marked platform.',
  },
];

export class MissionController {
  objectiveIndex = 0;
  checkpointId: 0 | 1 | 2 = 0;
  interactionPrompt = '';
  interactionProgress = 0;
  arrayDisabled = false;
  intelRetrieved = false;
  complete = false;

  constructor(private readonly world: FacilityWorld) {}

  start(): void {
    this.objectiveIndex = 0;
    this.checkpointId = 0;
    this.interactionPrompt = '';
    this.interactionProgress = 0;
    this.arrayDisabled = false;
    this.intelRetrieved = false;
    this.complete = false;
  }

  update(
    delta: number,
    playerPosition: THREE.Vector3,
    input: InputController,
    aliveEnemies: number,
  ): MissionEvent[] {
    const events: MissionEvent[] = [];
    this.interactionPrompt = '';

    if (this.objectiveIndex === 0) {
      const distance = playerPosition.distanceTo(this.world.securityCheckpointPosition);
      this.interactionProgress = THREE.MathUtils.clamp(1 - distance / 6, 0, 1);
      if (distance < 1.8) {
        this.objectiveIndex = 1;
        this.interactionProgress = 0;
        this.checkpointId = 1;
        events.push({
          type: 'checkpoint',
          id: 1,
          segment: 1,
          position: this.world.securityCheckpointPosition.clone(),
        });
      }
    } else if (this.objectiveIndex === 1) {
      const distance = playerPosition.distanceTo(this.world.commsTerminalPosition);
      if (distance < 2.45) {
        this.interactionPrompt = 'Hold E // Disable Eidolon array';
        this.updateHold(delta, input, 1.7);
        if (this.interactionProgress >= 1) {
          this.arrayDisabled = true;
          this.objectiveIndex = 2;
          this.interactionProgress = 0;
          events.push({ type: 'array-disabled' });
        }
      } else {
        this.interactionProgress = Math.max(0, this.interactionProgress - delta * 1.8);
      }
    } else if (this.objectiveIndex === 2) {
      const distance = playerPosition.distanceTo(this.world.intelPosition);
      if (distance < 2.25) {
        this.interactionPrompt = 'Hold E // Secure Echo Ledger';
        this.updateHold(delta, input, 0.85);
        if (this.interactionProgress >= 1) {
          this.intelRetrieved = true;
          this.objectiveIndex = 3;
          this.interactionProgress = 0;
          this.checkpointId = 2;
          events.push({ type: 'intel-retrieved' });
          events.push({
            type: 'checkpoint',
            id: 2,
            segment: 2,
            position: this.world.intelPosition
              .clone()
              .add(new THREE.Vector3(-2.5, 0, -2.5)),
          });
        }
      } else {
        this.interactionProgress = Math.max(0, this.interactionProgress - delta * 2.2);
      }
    } else if (this.objectiveIndex === 3) {
      const distance = playerPosition.distanceTo(this.world.extractionPosition);
      if (distance < 4.1) {
        if (aliveEnemies > 0) {
          this.interactionPrompt = `Extraction contested // ${aliveEnemies} hostiles remain`;
          this.interactionProgress = 0;
        } else {
          this.interactionPrompt = 'Hold E // Confirm extraction';
          this.updateHold(delta, input, 2.4);
          if (this.interactionProgress >= 1 && !this.complete) {
            this.complete = true;
            events.push({ type: 'complete' });
          }
        }
      } else {
        this.interactionProgress = Math.max(0, this.interactionProgress - delta * 1.2);
      }
    }
    return events;
  }

  getObjective(): ObjectiveState {
    const objective = OBJECTIVES[this.objectiveIndex] ?? OBJECTIVES[3];
    return {
      ...objective,
      progress: this.interactionProgress,
      completed: this.complete,
    };
  }

  getObjectivePosition(target = new THREE.Vector3()): THREE.Vector3 {
    switch (this.objectiveIndex) {
      case 0:
        return target.copy(this.world.securityCheckpointPosition);
      case 1:
        return target.copy(this.world.commsTerminalPosition);
      case 2:
        return target.copy(this.world.intelPosition);
      default:
        return target.copy(this.world.extractionPosition);
    }
  }

  snapshot(): MissionSnapshot {
    return {
      objectiveIndex: this.objectiveIndex,
      checkpointId: this.checkpointId,
      interactionProgress: 0,
    };
  }

  restore(snapshot: MissionSnapshot): void {
    this.objectiveIndex = snapshot.objectiveIndex;
    this.checkpointId = snapshot.checkpointId;
    this.interactionProgress = 0;
    this.arrayDisabled = snapshot.objectiveIndex >= 2;
    this.intelRetrieved = snapshot.objectiveIndex >= 3;
    this.complete = false;
  }

  setState(name: string): void {
    if (name === 'final-arena') {
      this.objectiveIndex = 3;
      this.checkpointId = 2;
      this.arrayDisabled = true;
      this.intelRetrieved = true;
    } else if (name === 'complete') {
      this.objectiveIndex = 3;
      this.complete = true;
    }
  }

  private updateHold(delta: number, input: InputController, duration: number): void {
    if (input.isDown('KeyE')) {
      this.interactionProgress = Math.min(1, this.interactionProgress + delta / duration);
    } else {
      this.interactionProgress = Math.max(0, this.interactionProgress - delta * 1.4);
    }
  }
}
