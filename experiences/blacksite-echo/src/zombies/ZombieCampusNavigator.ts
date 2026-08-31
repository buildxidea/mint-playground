import * as THREE from 'three';
import type { SplatContainment } from '../world/SplatContainment';
import type { SplatFramePortal } from '../world/SplatFrameCompletion';
import type { SplatNavigationSurface } from '../world/SplatNavigationSurface';
import type { Zombie, ZombieMovementIntent } from './Zombie';

export type ZombieCampusRoom = {
  id: string;
  anchor: THREE.Vector3;
  walkableBounds: THREE.Box3;
};

type RoomCoverage = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type ActorNavigationState = {
  roomId: string | null;
  targetRoomId: string | null;
  nextRoomId: string | null;
  roomsVisited: Set<string>;
  portalTransitions: number;
  distanceWalked: number;
  currentStuckSeconds: number;
  maxStuckSeconds: number;
  remainingPathDistance: number;
  noProgressSeconds: number;
  maxNoProgressSeconds: number;
  facingPlayerDot: number;
  minimumFacingPlayerDot: number;
  facingViolationSamples: number;
  coverageDistance: number;
  coverageByRoom: Map<string, RoomCoverage>;
  waypoints: THREE.Vector3[];
  waypointIndex: number;
  goalKey: string | null;
  laneSign: number;
  claimedPortalId: string | null;
  lastPortalId: string | null;
  portalCooldownSeconds: number;
  repathCount: number;
  recoveryCount: number;
};

type PortalTransfer = {
  portalId: string;
  nextRoomId: string;
  entry: THREE.Vector3;
  exit: THREE.Vector3;
  direction: THREE.Vector3;
  lateral: THREE.Vector3;
  continuous: true;
};

export type ZombieNavigationPlan = {
  intent: ZombieMovementIntent;
  transfer: PortalTransfer | null;
  playerPosition: THREE.Vector3;
  pathDistanceBeforeMove: number;
};

export type ZombieNavigationDiagnostics = {
  roomId: string | null;
  targetRoomId: string | null;
  nextRoomId: string | null;
  roomsVisited: string[];
  portalTransitions: number;
  distanceWalked: number;
  currentStuckSeconds: number;
  maxStuckSeconds: number;
  remainingPathDistance: number;
  noProgressSeconds: number;
  maxNoProgressSeconds: number;
  facingPlayerDot: number;
  minimumFacingPlayerDot: number;
  facingViolationSamples: number;
  coverageDistance: number;
  repathCount: number;
  recoveryCount: number;
  waypointCount: number;
  waypointIndex: number;
  coverageByRoom: Array<{
    roomId: string;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    spanX: number;
    spanZ: number;
  }>;
};

const ZOMBIE_CAPSULE_RADIUS = 0.42;
const PORTAL_STOP_DISTANCE = 0.08;
const PORTAL_EXIT_BIAS = 0.55;
const WAYPOINT_ARRIVAL = 0.55;
const STUCK_MOVEMENT_EPSILON = 0.002;
const PATH_PROGRESS_EPSILON = 0.004;
const STUCK_REPATH_SECONDS = 0.6;
const NO_PROGRESS_REPATH_SECONDS = 1.5;
const MAX_DOORWAY_OCCUPANCY = 3;
const LANE_SPACING = 0.22;
const PORTAL_REVERSE_COOLDOWN = 4.5;

/**
 * Non-blocking horde navigation over the same authored surface used by player
 * containment. Zombies never transfer by setting a destination-room position;
 * ownership changes only after their continuously resolved movement enters the
 * next room through an open portal polygon.
 */
export class ZombieCampusNavigator {
  private readonly rooms = new Map<string, ZombieCampusRoom>();
  private readonly portals: SplatFramePortal[] = [];
  private readonly states = new Map<string, ActorNavigationState>();
  private readonly portalClaims = new Map<string, Set<string>>();
  private surface: SplatNavigationSurface | null = null;
  private containment: SplatContainment | null = null;
  private playerRoomId: string | null = null;
  private readonly planHoldTarget = new THREE.Vector3();
  private readonly planSeekTarget = new THREE.Vector3();

  configure(
    rooms: ZombieCampusRoom[],
    portals: SplatFramePortal[],
    surface?: SplatNavigationSurface,
    containment?: SplatContainment,
  ): void {
    this.rooms.clear();
    for (const room of rooms) {
      this.rooms.set(room.id, {
        id: room.id,
        anchor: room.anchor.clone(),
        walkableBounds: room.walkableBounds.clone(),
      });
    }
    this.portals.length = 0;
    for (const portal of portals) {
      this.portals.push({
        ...portal,
        from: portal.from.clone(),
        to: portal.to.clone(),
        direction: portal.direction.clone(),
        traversalPolygon: portal.traversalPolygon.map((point) => point.clone()),
        transitionPolygon: portal.transitionPolygon.map((point) => point.clone()),
      });
    }
    this.surface = surface ?? null;
    this.containment = containment ?? null;
    this.states.clear();
    this.portalClaims.clear();
    this.playerRoomId = null;
  }

  resetActors(): void {
    for (const actorId of this.states.keys()) {
      this.containment?.removeActor(actorId);
    }
    this.states.clear();
    this.portalClaims.clear();
    this.playerRoomId = null;
  }

  registerSpawn(zombie: Zombie, position = zombie.group.position): void {
    const roomId = this.roomIdForPosition(position);
    const state = this.createState(roomId);
    this.states.set(zombie.id, state);
    this.containment?.registerActor(
      zombie.id,
      position,
      ZOMBIE_CAPSULE_RADIUS,
      true,
    );
    this.recordCoverage(state, position);
  }

  canCommitEntry(landing: THREE.Vector3, living: Zombie[]): boolean {
    if (
      this.surface &&
      !this.surface.containsCapsule(landing, ZOMBIE_CAPSULE_RADIUS)
    ) {
      return false;
    }
    return !living.some(
      (zombie) =>
        !zombie.isDefeated() &&
        !this.isExteriorState(zombie) &&
        zombie.group.position.distanceToSquared(landing) < 0.85 * 0.85,
    );
  }

  commitEntry(zombie: Zombie, landing: THREE.Vector3): boolean {
    const roomId = this.surface
      ? this.surface.roomIdForPosition(landing, ZOMBIE_CAPSULE_RADIUS)
      : this.roomIdForPosition(landing);
    if (!roomId) return false;
    if (
      this.containment &&
      !this.containment.commitEntry(
        zombie.id,
        landing,
        ZOMBIE_CAPSULE_RADIUS,
      )
    ) {
      return false;
    }
    zombie.commitResolvedPosition(landing);
    const state = this.ensureState(zombie);
    state.roomId = roomId;
    state.targetRoomId = null;
    state.nextRoomId = null;
    state.roomsVisited.add(roomId);
    state.coverageDistance =
      this.surface?.signedDistance(landing, ZOMBIE_CAPSULE_RADIUS) ??
      Number.POSITIVE_INFINITY;
    this.clearPath(state);
    this.releasePortalClaim(zombie.id, state);
    this.recordCoverage(state, landing);
    return zombie.finishEntryCommit();
  }

  assignRoom(zombie: Zombie, roomId?: string | null): string | null {
    const resolved =
      roomId && this.rooms.has(roomId)
        ? roomId
        : this.roomIdForPosition(zombie.group.position);
    const state = this.ensureState(zombie);
    state.roomId = resolved;
    state.targetRoomId = null;
    state.nextRoomId = null;
    if (resolved) state.roomsVisited.add(resolved);
    this.clearPath(state);
    this.recordCoverage(state, zombie.group.position);
    return resolved;
  }

  plan(
    zombie: Zombie,
    playerPosition: THREE.Vector3,
    requestedPlayerRoomId: string | null | undefined,
  ): ZombieNavigationPlan {
    const state = this.ensureState(zombie);
    const playerRoomId =
      requestedPlayerRoomId && this.rooms.has(requestedPlayerRoomId)
        ? requestedPlayerRoomId
        : this.roomIdForPosition(playerPosition);
    this.playerRoomId = playerRoomId;
    state.targetRoomId = playerRoomId;
    state.facingPlayerDot = zombie.facingPlayerDot(playerPosition);

    if (
      this.isExteriorState(zombie) ||
      zombie.state === 'entry-commit' ||
      zombie.isDefeated()
    ) {
      state.nextRoomId = null;
      this.releasePortalClaim(zombie.id, state);
      return this.holdPlan(zombie, playerPosition, state);
    }

    if (!state.roomId || !playerRoomId) {
      state.nextRoomId = null;
      this.releasePortalClaim(zombie.id, state);
      return this.holdPlan(zombie, playerPosition, state);
    }

    const pathDistance = this.geodesicDistance(
      zombie.group.position,
      state.roomId,
      playerPosition,
      playerRoomId,
    );
    state.remainingPathDistance = pathDistance;

    if (state.roomId === playerRoomId) {
      state.nextRoomId = null;
      this.releasePortalClaim(zombie.id, state);
      const goalKey = `seek:${playerRoomId}:${playerPosition.x.toFixed(1)}:${playerPosition.z.toFixed(1)}`;
      this.ensureWaypoints(zombie, state, goalKey, playerPosition);
      const target = this.currentWaypoint(zombie, state, playerPosition);
      // Intermediate navmesh waypoints must use a stop distance below
      // WAYPOINT_ARRIVAL; otherwise zombies halt ~1.25m short, enter attack,
      // and never advance across a large pad (Maps Outbreak full-map chase).
      const seekingFinalWaypoint =
        state.waypoints.length === 0 ||
        state.waypointIndex >= state.waypoints.length - 1;
      return {
        intent: {
          target,
          stopDistance: seekingFinalWaypoint ? 1.25 : 0.28,
          allowAttack: seekingFinalWaypoint,
        },
        transfer: null,
        playerPosition,
        pathDistanceBeforeMove: pathDistance,
      };
    }

    const transfer = this.selectPortalTransfer(
      zombie,
      state,
      state.roomId,
      playerRoomId,
    );
    state.nextRoomId = transfer?.nextRoomId ?? null;
    if (!transfer) {
      this.releasePortalClaim(zombie.id, state);
      return this.holdPlan(zombie, playerPosition, state);
    }

    this.claimPortal(zombie.id, state, transfer.portalId);
    const meshApproach =
      this.surface?.portalApproachPoint(
        transfer.portalId,
        state.roomId,
        1.2,
      ) ?? transfer.entry.clone();
    // When the bake stops short of the socket, start the seam march from the
    // nearest mesh lip but still aim the corridor at the real doorway entry.
    const approachDistance = Math.hypot(
      meshApproach.x - transfer.entry.x,
      meshApproach.z - transfer.entry.z,
    );
    const approach =
      approachDistance > 10
        ? meshApproach
        : meshApproach.clone().lerp(transfer.entry, 0.35);
    // Stay on the proven entry→exit line so movement must intersect the
    // transition polygon. Overlapping transformed rooms may require more than
    // a fixed half-metre exit bias before ownership actually changes.
    let portalTarget = transfer.exit
      .clone()
      .addScaledVector(transfer.direction, PORTAL_EXIT_BIAS);
    if (this.surface) {
      for (const exitDepth of [1.2, 2.4, 4, 6]) {
        const candidate = transfer.exit
          .clone()
          .addScaledVector(transfer.direction, exitDepth);
        portalTarget = candidate;
        if (
          this.surface.roomIdForPosition(
            candidate,
            ZOMBIE_CAPSULE_RADIUS,
          ) === transfer.nextRoomId &&
          this.surface.containsCapsuleInRoom(
            transfer.nextRoomId,
            candidate,
            ZOMBIE_CAPSULE_RADIUS,
          )
        ) {
          break;
        }
      }
    }
    portalTarget.add(transfer.lateral);
    // Stable key: do not toggle approach/exit every frame or pathing thrashes.
    const goalKey = `portal:${transfer.portalId}:${state.laneSign}`;
    this.ensurePortalWaypoints(
      zombie,
      state,
      goalKey,
      approach,
      portalTarget,
    );
    const target = this.currentWaypoint(zombie, state, portalTarget);
    return {
      intent: {
        target,
        stopDistance: PORTAL_STOP_DISTANCE,
        allowAttack: false,
      },
      transfer,
      playerPosition,
      pathDistanceBeforeMove: pathDistance,
    };
  }

  commit(
    zombie: Zombie,
    plan: ZombieNavigationPlan,
    previousPosition: THREE.Vector3,
    delta: number,
    sampleFootY?: (x: number, z: number, preferY: number) => number,
  ): void {
    const state = this.ensureState(zombie);
    if (
      this.isExteriorState(zombie) ||
      zombie.state === 'entry-commit' ||
      zombie.isDefeated()
    ) {
      return;
    }

    const proposed = zombie.group.position.clone();
    const resolution = this.containment
      ? this.containment.resolveMovement(
          zombie.id,
          previousPosition,
          proposed,
          ZOMBIE_CAPSULE_RADIUS,
          plan.transfer?.nextRoomId ?? null,
        )
      : this.surface?.projectMovement(
          previousPosition,
          proposed,
          ZOMBIE_CAPSULE_RADIUS,
        );
    const committed = resolution?.position ?? proposed;
    committed.y =
      sampleFootY?.(committed.x, committed.z, committed.y) ?? committed.y;
    zombie.commitResolvedPosition(committed);
    zombie.faceWorldTarget(plan.playerPosition);

    const walked = Math.hypot(
      committed.x - previousPosition.x,
      committed.z - previousPosition.z,
    );
    state.distanceWalked += walked;
    const previousRoomId = state.roomId;
    const resolvedRoomId =
      resolution?.roomId ?? this.roomIdForPosition(committed);
    if (resolvedRoomId && resolvedRoomId !== previousRoomId) {
      state.roomId = resolvedRoomId;
      state.nextRoomId = null;
      state.portalTransitions += 1;
      state.roomsVisited.add(resolvedRoomId);
      state.lastPortalId = plan.transfer?.portalId ?? state.claimedPortalId;
      state.portalCooldownSeconds = PORTAL_REVERSE_COOLDOWN;
      this.clearPath(state);
      this.releasePortalClaim(zombie.id, state);
    }
    if (state.portalCooldownSeconds > 0) {
      state.portalCooldownSeconds = Math.max(0, state.portalCooldownSeconds - delta);
    }

    const targetDistance = Math.hypot(
      plan.intent.target.x - committed.x,
      plan.intent.target.z - committed.z,
    );
    if (
      zombie.state === 'pursue' &&
      targetDistance > 0.5 &&
      walked < STUCK_MOVEMENT_EPSILON
    ) {
      state.currentStuckSeconds += delta;
      state.maxStuckSeconds = Math.max(
        state.maxStuckSeconds,
        state.currentStuckSeconds,
      );
    } else {
      state.currentStuckSeconds = 0;
    }

    const playerRoomId =
      state.targetRoomId ?? this.roomIdForPosition(plan.playerPosition);
    const pathDistanceAfter =
      state.roomId && playerRoomId
        ? this.geodesicDistance(
            committed,
            state.roomId,
            plan.playerPosition,
            playerRoomId,
          )
        : Number.POSITIVE_INFINITY;
    if (
      zombie.state === 'pursue' &&
      Number.isFinite(plan.pathDistanceBeforeMove) &&
      plan.pathDistanceBeforeMove > 1.7
    ) {
      if (
        pathDistanceAfter <=
        plan.pathDistanceBeforeMove - PATH_PROGRESS_EPSILON
      ) {
        state.noProgressSeconds = 0;
      } else {
        state.noProgressSeconds += delta;
        state.maxNoProgressSeconds = Math.max(
          state.maxNoProgressSeconds,
          state.noProgressSeconds,
        );
      }
    } else {
      state.noProgressSeconds = 0;
    }
    state.remainingPathDistance = pathDistanceAfter;
    state.facingPlayerDot = zombie.facingPlayerDot(plan.playerPosition);
    state.minimumFacingPlayerDot = Math.min(
      state.minimumFacingPlayerDot,
      state.facingPlayerDot,
    );
    if (state.facingPlayerDot < 0.98) state.facingViolationSamples += 1;
    state.coverageDistance =
      resolution?.signedDistance ??
      this.surface?.signedDistance(committed, ZOMBIE_CAPSULE_RADIUS) ??
      Number.POSITIVE_INFINITY;
    this.recordCoverage(state, committed);

    // Only unstuck when feet actually stop. Geodesic "no progress" alone can
    // fire while marching a long traversal corridor and would clear the seam
    // waypoints before the doorway crossing finishes.
    if (state.currentStuckSeconds >= STUCK_REPATH_SECONDS) {
      this.recoverFromStuck(zombie, state);
    } else if (
      state.noProgressSeconds >= NO_PROGRESS_REPATH_SECONDS * 2 &&
      state.portalCooldownSeconds > 0
    ) {
      // Direct doorway was cooling down too long; allow the short link again.
      state.portalCooldownSeconds = 0;
      state.lastPortalId = null;
      this.clearPath(state);
    } else if (
      state.noProgressSeconds >= NO_PROGRESS_REPATH_SECONDS &&
      (state.waypoints.length === 0 ||
        state.waypointIndex >= state.waypoints.length)
    ) {
      this.recoverFromStuck(zombie, state);
    }
  }

  diagnosticsFor(zombie: Zombie): ZombieNavigationDiagnostics {
    const state = this.ensureState(zombie);
    return {
      roomId: state.roomId,
      targetRoomId: state.targetRoomId,
      nextRoomId: state.nextRoomId,
      roomsVisited: [...state.roomsVisited],
      portalTransitions: state.portalTransitions,
      distanceWalked: state.distanceWalked,
      currentStuckSeconds: state.currentStuckSeconds,
      maxStuckSeconds: state.maxStuckSeconds,
      remainingPathDistance: state.remainingPathDistance,
      noProgressSeconds: state.noProgressSeconds,
      maxNoProgressSeconds: state.maxNoProgressSeconds,
      facingPlayerDot: state.facingPlayerDot,
      minimumFacingPlayerDot: state.minimumFacingPlayerDot,
      facingViolationSamples: state.facingViolationSamples,
      coverageDistance: state.coverageDistance,
      repathCount: state.repathCount,
      recoveryCount: state.recoveryCount,
      waypointCount: state.waypoints.length,
      waypointIndex: state.waypointIndex,
      coverageByRoom: [...state.coverageByRoom].map(([roomId, coverage]) => ({
        roomId,
        ...coverage,
        spanX: coverage.maxX - coverage.minX,
        spanZ: coverage.maxZ - coverage.minZ,
      })),
    };
  }

  openNeighborRoomIds(roomId: string): string[] {
    return this.neighbors(roomId);
  }

  diagnostics(): {
    configured: boolean;
    roomCount: number;
    portalCount: number;
    playerRoomId: string | null;
    postEntryZombieOutsideCoverageCount: number;
  } {
    return {
      configured: this.rooms.size > 0,
      roomCount: this.rooms.size,
      portalCount: this.portals.filter((portal) => this.isPortalReady(portal)).length,
      playerRoomId: this.playerRoomId,
      postEntryZombieOutsideCoverageCount:
        this.containment?.diagnosticsFor(this.states.keys()).outsideCoverageSamples ??
        0,
    };
  }

  private isPortalReady(portal: SplatFramePortal): boolean {
    return this.surface?.isPortalOpen(portal.id) ?? portal.ready;
  }

  private createState(roomId: string | null): ActorNavigationState {
    return {
      roomId,
      targetRoomId: null,
      nextRoomId: null,
      roomsVisited: new Set(roomId ? [roomId] : []),
      portalTransitions: 0,
      distanceWalked: 0,
      currentStuckSeconds: 0,
      maxStuckSeconds: 0,
      remainingPathDistance: Number.POSITIVE_INFINITY,
      noProgressSeconds: 0,
      maxNoProgressSeconds: 0,
      facingPlayerDot: 1,
      minimumFacingPlayerDot: 1,
      facingViolationSamples: 0,
      coverageDistance: Number.NEGATIVE_INFINITY,
      coverageByRoom: new Map(),
      waypoints: [],
      waypointIndex: 0,
      goalKey: null,
      laneSign: 1,
      claimedPortalId: null,
      lastPortalId: null,
      portalCooldownSeconds: 0,
      repathCount: 0,
      recoveryCount: 0,
    };
  }

  private ensureState(zombie: Zombie): ActorNavigationState {
    let state = this.states.get(zombie.id);
    if (!state) {
      this.registerSpawn(zombie);
      state = this.states.get(zombie.id)!;
    }
    return state;
  }

  private holdPlan(
    zombie: Zombie,
    playerPosition: THREE.Vector3,
    state: ActorNavigationState,
  ): ZombieNavigationPlan {
    this.clearPath(state);
    return {
      intent: {
        target: this.planHoldTarget.copy(zombie.group.position),
        stopDistance: 0,
        allowAttack: false,
      },
      transfer: null,
      playerPosition,
      pathDistanceBeforeMove: Number.POSITIVE_INFINITY,
    };
  }

  private ensureWaypoints(
    zombie: Zombie,
    state: ActorNavigationState,
    goalKey: string,
    goal: THREE.Vector3,
  ): void {
    if (state.goalKey === goalKey && state.waypoints.length > 0) {
      return;
    }
    const roomId = state.roomId;
    const path =
      roomId && this.surface
        ? this.surface.findNavigationPath(
            roomId,
            zombie.group.position,
            goal,
          )
        : null;
    state.goalKey = goalKey;
    state.waypoints = path?.map((point) => point.clone()) ?? [goal.clone()];
    state.waypointIndex = 0;
    state.repathCount += 1;
  }

  private ensurePortalWaypoints(
    zombie: Zombie,
    state: ActorNavigationState,
    goalKey: string,
    approach: THREE.Vector3,
    exit: THREE.Vector3,
  ): void {
    if (state.goalKey === goalKey && state.waypoints.length > 0) {
      return;
    }
    const roomId = state.roomId;
    const toApproach =
      roomId && this.surface
        ? this.surface.findNavigationPath(
            roomId,
            zombie.group.position,
            approach,
          )
        : null;
    const waypoints = (toApproach ?? [approach]).map((point) => point.clone());
    // Doorway sockets can sit beyond the bake. March from the mesh edge through
    // the open traversal polygon so straight-line slides cannot stall on the lip.
    const seamSteps = 8;
    for (let index = 1; index <= seamSteps; index += 1) {
      const t = index / seamSteps;
      waypoints.push(
        new THREE.Vector3(
          approach.x + (exit.x - approach.x) * t,
          exit.y,
          approach.z + (exit.z - approach.z) * t,
        ),
      );
    }
    state.goalKey = goalKey;
    state.waypoints = waypoints;
    state.waypointIndex = 0;
    state.repathCount += 1;
  }

  private currentWaypoint(
    zombie: Zombie,
    state: ActorNavigationState,
    fallback: THREE.Vector3,
  ): THREE.Vector3 {
    while (state.waypointIndex < state.waypoints.length) {
      const waypoint = state.waypoints[state.waypointIndex]!;
      const distance = Math.hypot(
        waypoint.x - zombie.group.position.x,
        waypoint.z - zombie.group.position.z,
      );
      if (distance > WAYPOINT_ARRIVAL) {
        return this.planSeekTarget.copy(waypoint);
      }
      state.waypointIndex += 1;
    }
    // Path exhausted: seek the live goal directly instead of rebuilding every
    // frame (which thrashed repathCount and stalled portal approaches).
    return this.planSeekTarget.copy(fallback);
  }

  private clearPath(state: ActorNavigationState): void {
    state.waypoints = [];
    state.waypointIndex = 0;
    state.goalKey = null;
  }

  private recoverFromStuck(
    zombie: Zombie,
    state: ActorNavigationState,
  ): void {
    state.recoveryCount += 1;
    state.currentStuckSeconds = 0;
    state.noProgressSeconds = 0;
    state.laneSign *= -1;
    if (state.claimedPortalId) {
      this.releasePortalClaim(zombie.id, state);
    }
    this.clearPath(state);
  }

  private selectPortalTransfer(
    zombie: Zombie,
    state: ActorNavigationState,
    fromRoomId: string,
    playerRoomId: string,
  ): PortalTransfer | null {
    const excluded = new Set<string>();
    if (state.portalCooldownSeconds > 0 && state.lastPortalId) {
      excluded.add(state.lastPortalId);
    }
    const primaryPath =
      this.surface?.findRoomPath(fromRoomId, playerRoomId, excluded) ??
      (excluded.size > 0
        ? this.surface?.findRoomPath(fromRoomId, playerRoomId)
        : null) ??
      this.legacyRoomPath(fromRoomId, playerRoomId);
    const primaryNext = primaryPath?.[1] ?? null;
    // Keep a claim only while it still advances the room path to the player.
    if (state.claimedPortalId) {
      const claimed = this.portals.find(
        (portal) =>
          portal.id === state.claimedPortalId && this.isPortalReady(portal),
      );
      const claimedNext =
        claimed?.fromId === fromRoomId
          ? claimed.toId
          : claimed?.toId === fromRoomId
            ? claimed.fromId
            : null;
      if (
        claimedNext &&
        claimedNext === primaryNext &&
        !excluded.has(state.claimedPortalId)
      ) {
        const stuckOnClaim =
          this.portalTransfer(zombie, state, fromRoomId, claimedNext);
        if (stuckOnClaim) return stuckOnClaim;
      } else {
        this.releasePortalClaim(zombie.id, state);
      }
    }
    const primary = primaryNext
      ? this.portalTransfer(zombie, state, fromRoomId, primaryNext)
      : null;
    if (
      primary &&
      !excluded.has(primary.portalId) &&
      this.portalOccupancy(primary.portalId, zombie.id) < MAX_DOORWAY_OCCUPANCY
    ) {
      return primary;
    }
    if (primary) {
      const blocked = new Set(excluded);
      if (primary.portalId) blocked.add(primary.portalId);
      const alternatePath = this.surface?.findRoomPath(
        fromRoomId,
        playerRoomId,
        blocked,
      );
      const alternateNext = alternatePath?.[1] ?? null;
      if (alternateNext) {
        const alternate = this.portalTransfer(
          zombie,
          state,
          fromRoomId,
          alternateNext,
        );
        if (
          alternate &&
          this.portalOccupancy(alternate.portalId, zombie.id) <
            MAX_DOORWAY_OCCUPANCY
        ) {
          return alternate;
        }
      }
      if (primary && !excluded.has(primary.portalId)) return primary;
    }
    return null;
  }

  private portalOccupancy(portalId: string, exceptZombieId?: string): number {
    const claimants = this.portalClaims.get(portalId);
    if (!claimants) return 0;
    if (!exceptZombieId) return claimants.size;
    let count = 0;
    for (const id of claimants) {
      if (id !== exceptZombieId) count += 1;
    }
    return count;
  }

  private claimPortal(
    zombieId: string,
    state: ActorNavigationState,
    portalId: string,
  ): void {
    if (state.claimedPortalId === portalId) return;
    this.releasePortalClaim(zombieId, state);
    const claimants = this.portalClaims.get(portalId) ?? new Set<string>();
    claimants.add(zombieId);
    this.portalClaims.set(portalId, claimants);
    state.claimedPortalId = portalId;
  }

  private releasePortalClaim(
    zombieId: string,
    state: ActorNavigationState,
  ): void {
    if (!state.claimedPortalId) return;
    const claimants = this.portalClaims.get(state.claimedPortalId);
    claimants?.delete(zombieId);
    if (claimants && claimants.size === 0) {
      this.portalClaims.delete(state.claimedPortalId);
    }
    state.claimedPortalId = null;
  }

  private roomIdForPosition(position: THREE.Vector3): string | null {
    if (this.surface) {
      return this.surface.roomIdForPosition(position, ZOMBIE_CAPSULE_RADIUS);
    }
    let closest: { id: string; distanceSq: number } | null = null;
    for (const room of this.rooms.values()) {
      const dx = position.x - room.anchor.x;
      const dz = position.z - room.anchor.z;
      const distanceSq = dx * dx + dz * dz;
      if (!closest || distanceSq < closest.distanceSq) {
        closest = { id: room.id, distanceSq };
      }
    }
    return closest?.id ?? null;
  }

  private portalTransfer(
    zombie: Zombie,
    state: ActorNavigationState,
    fromRoomId: string,
    nextRoomId: string,
  ): PortalTransfer | null {
    const portal = this.portals.find(
      (entry) =>
        this.isPortalReady(entry) &&
        ((entry.fromId === fromRoomId && entry.toId === nextRoomId) ||
          (entry.toId === fromRoomId && entry.fromId === nextRoomId)),
    );
    if (!portal) return null;
    const forward = portal.fromId === fromRoomId;
    // Prefer baked landings over raw doorway sockets. Some cut pairs have
    // swapped/offset sockets that sit on the wrong side of the seam.
    const entry =
      this.surface?.portalLandingPoint(
        portal.id,
        fromRoomId,
        ZOMBIE_CAPSULE_RADIUS,
      ) ?? (forward ? portal.from : portal.to).clone();
    const exit =
      this.surface?.portalLandingPoint(
        portal.id,
        nextRoomId,
        ZOMBIE_CAPSULE_RADIUS,
      ) ?? (forward ? portal.to : portal.from).clone();
    // Socket transforms describe the authored cut orientation, but rotated or
    // offset captures can make that vector diverge from the capsule-safe
    // route. Drive the seam march and its exit bias from the proven landings.
    // This keeps the final target on the destination side instead of pinning
    // actors against the source nav lip (east -> west was the regression).
    const direction = exit.clone().sub(entry).setY(0);
    if (direction.lengthSq() <= 1e-6) {
      direction.copy(
        forward ? portal.direction : portal.direction.clone().negate(),
      );
    }
    direction.normalize();
    const slot = this.slotFor(zombie);
    const laneIndex = ((slot % 5) - 2) * state.laneSign;
    const maxLane =
      Math.max(0.2, portal.radius - ZOMBIE_CAPSULE_RADIUS - 0.08);
    const lane = THREE.MathUtils.clamp(laneIndex * LANE_SPACING, -maxLane, maxLane);
    const lateral = new THREE.Vector3(-direction.z * lane, 0, direction.x * lane);
    return {
      portalId: portal.id,
      nextRoomId,
      entry: entry.clone(),
      exit: exit.clone(),
      direction,
      lateral,
      continuous: true,
    };
  }

  private geodesicDistance(
    start: THREE.Vector3,
    startRoomId: string,
    target: THREE.Vector3,
    targetRoomId: string,
  ): number {
    if (startRoomId === targetRoomId) {
      return Math.hypot(target.x - start.x, target.z - start.z);
    }
    const path =
      this.surface?.findRoomPath(startRoomId, targetRoomId) ??
      this.legacyRoomPath(startRoomId, targetRoomId);
    if (!path || path.length < 2) return Number.POSITIVE_INFINITY;
    let cursor = start.clone();
    let distance = 0;
    for (let index = 0; index < path.length - 1; index += 1) {
      const fromRoomId = path[index]!;
      const toRoomId = path[index + 1]!;
      const portal = this.portals.find(
        (candidate) =>
          this.isPortalReady(candidate) &&
          ((candidate.fromId === fromRoomId && candidate.toId === toRoomId) ||
            (candidate.toId === fromRoomId && candidate.fromId === toRoomId)),
      );
      if (!portal) return Number.POSITIVE_INFINITY;
      const forward = portal.fromId === fromRoomId;
      const entry = forward ? portal.from : portal.to;
      const exit = forward ? portal.to : portal.from;
      distance += Math.hypot(entry.x - cursor.x, entry.z - cursor.z);
      distance += Math.hypot(exit.x - entry.x, exit.z - entry.z);
      cursor = exit;
    }
    return distance + Math.hypot(target.x - cursor.x, target.z - cursor.z);
  }

  private legacyRoomPath(
    fromRoomId: string,
    targetRoomId: string,
  ): string[] | null {
    if (fromRoomId === targetRoomId) return [fromRoomId];
    const previous = new Map<string, string | null>([[fromRoomId, null]]);
    const queue = [fromRoomId];
    while (queue.length > 0) {
      const roomId = queue.shift()!;
      for (const neighbor of this.neighbors(roomId)) {
        if (previous.has(neighbor)) continue;
        previous.set(neighbor, roomId);
        if (neighbor === targetRoomId) {
          const path = [targetRoomId];
          let cursor: string | null = roomId;
          while (cursor) {
            path.push(cursor);
            cursor = previous.get(cursor) ?? null;
          }
          return path.reverse();
        }
        queue.push(neighbor);
      }
    }
    return null;
  }

  private neighbors(roomId: string): string[] {
    const result: string[] = [];
    for (const portal of this.portals) {
      if (!this.isPortalReady(portal)) continue;
      if (portal.fromId === roomId) result.push(portal.toId);
      else if (portal.toId === roomId) result.push(portal.fromId);
    }
    return result;
  }

  private isExteriorState(zombie: Zombie): boolean {
    return zombie.state === 'outside-spawn' || zombie.state === 'crawling';
  }

  private slotFor(zombie: Zombie): number {
    const numeric = Number.parseInt(zombie.id.replace(/\D+/g, ''), 10);
    if (Number.isFinite(numeric)) return Math.max(0, numeric - 1);
    let hash = 0;
    for (const char of zombie.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash;
  }

  private recordCoverage(
    state: ActorNavigationState,
    position: THREE.Vector3,
  ): void {
    if (!state.roomId) return;
    const existing = state.coverageByRoom.get(state.roomId);
    if (!existing) {
      state.coverageByRoom.set(state.roomId, {
        minX: position.x,
        maxX: position.x,
        minZ: position.z,
        maxZ: position.z,
      });
      return;
    }
    existing.minX = Math.min(existing.minX, position.x);
    existing.maxX = Math.max(existing.maxX, position.x);
    existing.minZ = Math.min(existing.minZ, position.z);
    existing.maxZ = Math.max(existing.maxZ, position.z);
  }
}
