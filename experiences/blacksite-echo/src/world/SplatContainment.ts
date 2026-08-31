import * as THREE from 'three';
import type {
  SplatMovementResolution,
  SplatNavigationSurface,
} from './SplatNavigationSurface';

type ActorState = {
  lastValidPosition: THREE.Vector3;
  roomId: string | null;
  outsideSamples: number;
  recoveries: number;
};

export class SplatContainment {
  private readonly actors = new Map<string, ActorState>();
  readonly surface: SplatNavigationSurface;

  constructor(surface: SplatNavigationSurface) {
    this.surface = surface;
  }

  registerActor(
    actorId: string,
    position: THREE.Vector3,
    capsuleRadius: number,
    allowOutside = false,
    preferredRoomId: string | null = null,
  ): boolean {
    const roomId =
      preferredRoomId ??
      this.surface.roomIdForPosition(position, capsuleRadius);
    const inside = roomId
      ? this.surface.containsCapsuleInRoom(roomId, position, capsuleRadius)
      : false;
    if (!inside && !allowOutside) return false;
    this.actors.set(actorId, {
      lastValidPosition: position.clone(),
      roomId: inside ? roomId : null,
      outsideSamples: 0,
      recoveries: 0,
    });
    return true;
  }

  commitEntry(
    actorId: string,
    landing: THREE.Vector3,
    capsuleRadius: number,
    preferredRoomId: string | null = null,
  ): boolean {
    const roomId =
      preferredRoomId ??
      this.surface.roomIdForPosition(landing, capsuleRadius);
    if (
      !roomId ||
      !this.surface.containsCapsuleInRoom(roomId, landing, capsuleRadius)
    ) {
      return false;
    }
    const state = this.actors.get(actorId);
    if (!state) {
      return this.registerActor(
        actorId,
        landing,
        capsuleRadius,
        false,
        roomId,
      );
    }
    state.lastValidPosition.copy(landing);
    state.roomId = roomId;
    return true;
  }

  resolveMovement(
    actorId: string,
    previous: THREE.Vector3,
    proposed: THREE.Vector3,
    capsuleRadius: number,
    allowedDestinationRoomId?: string | null,
  ): SplatMovementResolution {
    let state = this.actors.get(actorId);
    if (!state) {
      state = {
        lastValidPosition: previous.clone(),
        roomId: this.surface.roomIdForPosition(previous, capsuleRadius),
        outsideSamples: 0,
        recoveries: 0,
      };
      this.actors.set(actorId, state);
    }
    const resolution = this.surface.projectMovement(
      previous,
      proposed,
      capsuleRadius,
      state.roomId,
    );
    if (resolution.signedDistance < 0) {
      state.outsideSamples += 1;
      state.recoveries += 1;
      resolution.position.copy(state.lastValidPosition);
      resolution.roomId = state.roomId;
      resolution.constrained = true;
      return resolution;
    }
    // Planned actors (zombies) can overlap multiple baked room meshes inside
    // a doorway. Do not let that ambiguity flip ownership to an unrelated
    // neighbor on every frame; the active portal plan names the only legal
    // destination. Callers that omit this argument (the player) retain free
    // traversal through any ready authored doorway.
    if (
      allowedDestinationRoomId !== undefined &&
      state.roomId &&
      resolution.roomId &&
      resolution.roomId !== state.roomId &&
      resolution.roomId !== allowedDestinationRoomId
    ) {
      resolution.roomId = state.roomId;
    }
    state.lastValidPosition.copy(resolution.position);
    state.roomId = resolution.roomId;
    return resolution;
  }

  auditSample(
    actorId: string,
    position: THREE.Vector3,
    capsuleRadius: number,
  ): boolean {
    const state = this.actors.get(actorId);
    const inside = state?.roomId
      ? this.surface.containsCapsuleForActor(
          state.roomId,
          position,
          capsuleRadius,
        )
      : this.surface.containsCapsule(position, capsuleRadius);
    if (!inside && state) state.outsideSamples += 1;
    return inside;
  }

  containsActor(
    actorId: string,
    position: THREE.Vector3,
    capsuleRadius: number,
  ): boolean {
    const roomId = this.actors.get(actorId)?.roomId;
    return roomId
      ? this.surface.containsCapsuleForActor(
          roomId,
          position,
          capsuleRadius,
        )
      : this.surface.containsCapsule(position, capsuleRadius);
  }

  roomId(actorId: string): string | null {
    return this.actors.get(actorId)?.roomId ?? null;
  }

  removeActor(actorId: string): void {
    this.actors.delete(actorId);
  }

  diagnostics(): {
    actorCount: number;
    outsideCoverageSamples: number;
    recoveries: number;
  } {
    return this.diagnosticsFor(this.actors.keys());
  }

  diagnosticsFor(actorIds: Iterable<string>): {
    actorCount: number;
    outsideCoverageSamples: number;
    recoveries: number;
  } {
    const requested = new Set(actorIds);
    let outsideCoverageSamples = 0;
    let recoveries = 0;
    let actorCount = 0;
    for (const [actorId, state] of this.actors) {
      if (!requested.has(actorId)) continue;
      actorCount += 1;
      outsideCoverageSamples += state.outsideSamples;
      recoveries += state.recoveries;
    }
    return {
      actorCount,
      outsideCoverageSamples,
      recoveries,
    };
  }
}
