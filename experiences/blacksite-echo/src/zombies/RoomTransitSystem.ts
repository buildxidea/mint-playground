import * as THREE from 'three';
import type {
  SplatNavigationSurface,
  SplatWorldRoom,
} from '../world/SplatNavigationSurface';

export type CampusRoomNavigationState = {
  currentRoom: {
    id: string;
    label: string;
  };
  target: {
    terminalId: string;
    kind: 'power' | 'door' | 'relay';
    roomId: string;
    label: string;
    goalLabel: string;
    position: THREE.Vector3;
    distance: number;
    inRange: boolean;
    available: boolean;
    requirement: string | null;
  } | null;
  rooms: Array<{
    id: string;
    label: string;
    shortLabel: string;
    visited: boolean;
    active: boolean;
  }>;
};

export type RoomTransitDestination = {
  terminalId: string;
  fromRoomId: string;
  toRoomId: string;
  toLabel: string;
  landing: THREE.Vector3;
};

type TransitTerminal = {
  id: string;
  fromRoomId: string;
  toRoomId: string;
  position: THREE.Vector3;
  landing: THREE.Vector3;
};

export type RoomTransitProgressionAnchors = {
  powerSwitch: {
    roomId: string;
    position: THREE.Vector3;
  };
  doors: Array<{
    id: string;
    roomId: string;
    position: THREE.Vector3;
  }>;
};

const ROOM_LABELS: Record<string, { label: string; shortLabel: string }> = {
  'world-zombies-arena': { label: 'Hub', shortLabel: 'HUB' },
  'world-zombies-arena-north': { label: 'North', shortLabel: 'NTH' },
  'world-zombies-arena-south': { label: 'South', shortLabel: 'STH' },
  'world-zombies-arena-east': { label: 'East', shortLabel: 'EST' },
  'world-zombies-arena-west': { label: 'West', shortLabel: 'WST' },
  'world-zombies-arena-far-north': {
    label: 'Far North',
    shortLabel: 'FAR',
  },
};

const ROOM_VISIT_ORDER = [
  'world-zombies-arena',
  'world-zombies-arena-north',
  'world-zombies-arena-far-north',
  'world-zombies-arena-east',
  'world-zombies-arena-south',
  'world-zombies-arena-west',
] as const;

const TRANSIT_LINKS: ReadonlyArray<readonly [string, string]> = [
  ['world-zombies-arena', 'world-zombies-arena-north'],
  ['world-zombies-arena-north', 'world-zombies-arena-far-north'],
  ['world-zombies-arena', 'world-zombies-arena-east'],
  ['world-zombies-arena', 'world-zombies-arena-west'],
  ['world-zombies-arena', 'world-zombies-arena-south'],
];

// Every campus relay is placed 4.5 m from its room's safe arrival clearing.
// Keeping that clearing inside the usable radius guarantees decorative
// source-splat props cannot strand the player between disconnected rooms.
// Exact target ownership below prevents an overlapping neighboring relay from
// consuming the same interaction.
const INTERACTION_RADIUS = 4.75;
const MINIMUM_TERMINAL_SEPARATION = 3;
const PLAYER_CAPSULE_RADIUS = 0.34;

const LINK_DOOR_GATES = new Map<string, string>([
  [
    [
      'world-zombies-arena',
      'world-zombies-arena-north',
    ].sort().join('|'),
    'door-spawn-mid',
  ],
  [
    [
      'world-zombies-arena-north',
      'world-zombies-arena-far-north',
    ].sort().join('|'),
    'door-mid-power',
  ],
  [
    [
      'world-zombies-arena',
      'world-zombies-arena-south',
    ].sort().join('|'),
    'door-power-pap',
  ],
]);

function roomLabel(roomId: string): { label: string; shortLabel: string } {
  return (
    ROOM_LABELS[roomId] ?? {
      label: roomId.replace(/^world-zombies-arena-?/, '') || 'Hub',
      shortLabel: roomId.slice(0, 3).toUpperCase(),
    }
  );
}

function transitLinkKey(leftRoomId: string, rightRoomId: string): string {
  return [leftRoomId, rightRoomId].sort().join('|');
}

export class RoomTransitSystem {
  private readonly terminals: TransitTerminal[] = [];
  private readonly visited = new Set<string>();
  private readonly markerRoot = new THREE.Group();
  private readonly markerByTerminal = new Map<string, THREE.Group>();
  private readonly openDoorIds = new Set<string>();
  private readonly progressionDoors = new Map<
    string,
    { roomId: string; position: THREE.Vector3 }
  >();
  private surface: SplatNavigationSurface | null = null;
  private powerSwitch:
    | { roomId: string; position: THREE.Vector3 }
    | null = null;
  private powerOn = false;
  private transfers = 0;

  constructor() {
    this.markerRoot.name = 'zombies-room-transit-relays';
    this.markerRoot.visible = false;
  }

  configure(
    surface: SplatNavigationSurface,
    scene: THREE.Scene,
    progressionAnchors: RoomTransitProgressionAnchors,
  ): void {
    this.clear();
    this.surface = surface;
    this.visited.add(surface.layout.startRoomId);
    this.powerSwitch = {
      roomId: progressionAnchors.powerSwitch.roomId,
      position: progressionAnchors.powerSwitch.position.clone(),
    };
    for (const door of progressionAnchors.doors) {
      this.progressionDoors.set(door.id, {
        roomId: door.roomId,
        position: door.position.clone(),
      });
    }

    if (!this.markerRoot.parent) scene.add(this.markerRoot);
    if (surface.validation.releaseReady) {
      // A release-ready campus is continuously walkable. Relay teleporters
      // are retained only as a fail-safe for legacy disconnected layouts.
      this.markerRoot.visible = false;
      return;
    }
    for (const [aId, bId] of TRANSIT_LINKS) {
      const a = surface.room(aId);
      const b = surface.room(bId);
      if (!a || !b) continue;
      this.addTerminal(a, b);
      this.addTerminal(b, a);
    }
    this.markerRoot.visible = true;
  }

  clear(): void {
    this.markerRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) material.dispose();
    });
    this.terminals.length = 0;
    this.visited.clear();
    this.transfers = 0;
    this.markerByTerminal.clear();
    this.openDoorIds.clear();
    this.progressionDoors.clear();
    this.markerRoot.clear();
    this.markerRoot.visible = false;
    this.powerSwitch = null;
    this.powerOn = false;
    this.surface = null;
  }

  setProgressionState(
    powerOn: boolean,
    openDoorIds: readonly string[],
  ): void {
    this.powerOn = powerOn;
    this.openDoorIds.clear();
    for (const doorId of openDoorIds) this.openDoorIds.add(doorId);
  }

  markVisited(roomId: string | null): void {
    if (roomId) this.visited.add(roomId);
  }

  updateVisuals(
    elapsed: number,
    currentRoomId: string | null,
    targetTerminalId: string | null,
  ): void {
    for (const terminal of this.terminals) {
      const marker = this.markerByTerminal.get(terminal.id);
      if (!marker) continue;
      marker.visible =
        terminal.fromRoomId === currentRoomId &&
        this.isTerminalAvailable(terminal);
      const active = terminal.id === targetTerminalId;
      marker.scale.setScalar(
        (active ? 1 : 0.78) + Math.sin(elapsed * 3.8 + terminal.position.x) * 0.04,
      );
      marker.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const material = object.material;
        if (!(material instanceof THREE.MeshBasicMaterial)) return;
        material.opacity = active ? 0.82 : 0.32;
      });
    }
  }

  getNavigation(
    playerPosition: THREE.Vector3,
    currentRoomId: string | null,
  ): CampusRoomNavigationState {
    const surface = this.surface;
    const resolvedCurrent =
      currentRoomId ??
      surface?.roomIdForPosition(playerPosition, 0.34) ??
      surface?.layout.startRoomId ??
      'world-zombies-arena';
    this.markVisited(resolvedCurrent);

    const goal = ROOM_VISIT_ORDER.find(
      (roomId) => surface?.room(roomId) && !this.visited.has(roomId),
    );
    const target = goal
      ? this.resolveNavigationTarget(resolvedCurrent, goal)
      : null;
    const targetDistance = target
      ? playerPosition.distanceTo(target.position)
      : 0;

    return {
      currentRoom: {
        id: resolvedCurrent,
        label: roomLabel(resolvedCurrent).label,
      },
      target:
        target && goal
          ? {
              terminalId: target.id,
              kind: target.kind,
              roomId: target.roomId,
              label: target.label,
              goalLabel: roomLabel(goal).label,
              position: target.position.clone(),
              distance: targetDistance,
              inRange: targetDistance <= target.radius,
              available: target.available,
              requirement: target.requirement,
            }
          : null,
      rooms: ROOM_VISIT_ORDER.flatMap((roomId) =>
        surface?.room(roomId)
          ? [
              {
                id: roomId,
                label: roomLabel(roomId).label,
                shortLabel: roomLabel(roomId).shortLabel,
                visited: this.visited.has(roomId),
                active: roomId === resolvedCurrent,
              },
            ]
          : [],
      ),
    };
  }

  interaction(
    playerPosition: THREE.Vector3,
    currentRoomId: string | null,
    preferredTerminalId: string | null = null,
    targetOnly = false,
  ): RoomTransitDestination | null {
    if (!currentRoomId) return null;
    if (preferredTerminalId) {
      const preferred = this.terminals.find(
        (terminal) =>
          terminal.id === preferredTerminalId &&
          terminal.fromRoomId === currentRoomId &&
          this.isTerminalAvailable(terminal),
      );
      if (
        preferred &&
        playerPosition.distanceToSquared(preferred.position) <=
          INTERACTION_RADIUS * INTERACTION_RADIUS
      ) {
        return this.destinationFor(preferred);
      }
    }
    if (targetOnly) return null;

    let nearest: TransitTerminal | null = null;
    let nearestDistanceSq = INTERACTION_RADIUS * INTERACTION_RADIUS;
    for (const terminal of this.terminals) {
      if (
        terminal.fromRoomId !== currentRoomId ||
        !this.isTerminalAvailable(terminal)
      ) {
        continue;
      }
      const distanceSq = playerPosition.distanceToSquared(terminal.position);
      if (distanceSq >= nearestDistanceSq) continue;
      nearest = terminal;
      nearestDistanceSq = distanceSq;
    }
    if (!nearest) return null;
    return this.destinationFor(nearest);
  }

  private destinationFor(
    terminal: TransitTerminal,
  ): RoomTransitDestination {
    return {
      terminalId: terminal.id,
      fromRoomId: terminal.fromRoomId,
      toRoomId: terminal.toRoomId,
      toLabel: roomLabel(terminal.toRoomId).label,
      landing: terminal.landing.clone(),
    };
  }

  complete(destination: RoomTransitDestination): void {
    this.visited.add(destination.toRoomId);
    this.transfers += 1;
  }

  snapshot(
    playerPosition: THREE.Vector3,
    currentRoomId: string | null,
  ): {
    currentRoomId: string | null;
    player: { x: number; y: number; z: number };
    currentRoomLanding: { x: number; y: number; z: number } | null;
    visitedRoomIds: string[];
    transferCount: number;
    navigation: CampusRoomNavigationState;
    selectedInteractionTerminalId: string | null;
    progression: {
      powerOn: boolean;
      openDoorIds: string[];
    };
    terminals: Array<{
      id: string;
      fromRoomId: string;
      toRoomId: string;
      x: number;
      y: number;
      z: number;
      navSafe: boolean;
      landingNavSafe: boolean;
      clearPathFromLanding: boolean;
      nearestTerminalDistance: number | null;
      available: boolean;
    }>;
  } {
    const navigation = this.getNavigation(playerPosition, currentRoomId);
    const preferredTerminalId =
      navigation.target?.kind === 'relay'
        ? navigation.target.terminalId
        : null;
    const selected = this.interaction(
      playerPosition,
      currentRoomId,
      preferredTerminalId,
      Boolean(navigation.target),
    );
    const currentRoom = currentRoomId
      ? this.surface?.room(currentRoomId)
      : null;
    const currentRoomLanding = currentRoom
      ? currentRoom.anchor.clone().setY(currentRoom.floorY + 0.98)
      : null;
    return {
      currentRoomId,
      player: {
        x: playerPosition.x,
        y: playerPosition.y,
        z: playerPosition.z,
      },
      currentRoomLanding: currentRoomLanding
        ? {
            x: currentRoomLanding.x,
            y: currentRoomLanding.y,
            z: currentRoomLanding.z,
          }
        : null,
      visitedRoomIds: [...this.visited],
      transferCount: this.transfers,
      navigation,
      selectedInteractionTerminalId: selected?.terminalId ?? null,
      progression: {
        powerOn: this.powerOn,
        openDoorIds: [...this.openDoorIds],
      },
      terminals: this.terminals.map((terminal) => ({
        id: terminal.id,
        fromRoomId: terminal.fromRoomId,
        toRoomId: terminal.toRoomId,
        x: terminal.position.x,
        y: terminal.position.y,
        z: terminal.position.z,
        navSafe:
          this.surface?.containsCapsuleInRoom(
            terminal.fromRoomId,
            terminal.position,
            PLAYER_CAPSULE_RADIUS,
          ) ?? false,
        landingNavSafe:
          this.surface?.containsCapsuleInRoom(
            terminal.toRoomId,
            terminal.landing,
            PLAYER_CAPSULE_RADIUS,
          ) ?? false,
        clearPathFromLanding:
          this.hasClearPathFromRoomLanding(
            terminal.fromRoomId,
            terminal.position,
          ),
        nearestTerminalDistance: this.nearestTerminalDistance(terminal),
        available: this.isTerminalAvailable(terminal),
      })),
    };
  }

  private addTerminal(from: SplatWorldRoom, to: SplatWorldRoom): void {
    const id = `relay-${from.source.id}-to-${to.source.id}`;
    const position = this.findTerminalPosition(from, to);
    if (!position) {
      throw new Error(
        `${id}: no unique capsule-safe relay approach with a clear landing path`,
      );
    }
    const landing = to.anchor.clone().setY(to.floorY + 0.98);
    if (
      !this.surface?.containsCapsuleInRoom(
        to.source.id,
        landing,
        PLAYER_CAPSULE_RADIUS,
      )
    ) {
      throw new Error(`${id}: unsafe destination landing`);
    }
    const terminal: TransitTerminal = {
      id,
      fromRoomId: from.source.id,
      toRoomId: to.source.id,
      position,
      landing,
    };
    this.terminals.push(terminal);

    const marker = this.createMarker(roomLabel(to.source.id).shortLabel);
    marker.name = id;
    marker.position.set(position.x, from.floorY + 0.08, position.z);
    marker.userData.roomTransitTerminal = id;
    marker.userData.roomTransitDestination = to.source.id;
    this.markerRoot.add(marker);
    this.markerByTerminal.set(id, marker);
  }

  private findTerminalPosition(
    from: SplatWorldRoom,
    to: SplatWorldRoom,
  ): THREE.Vector3 | null {
    const surface = this.surface;
    if (!surface) return null;
    const landing = from.anchor.clone().setY(from.floorY + 0.98);
    if (
      !surface.containsCapsuleInRoom(
        from.source.id,
        landing,
        PLAYER_CAPSULE_RADIUS,
      )
    ) {
      return null;
    }
    const desiredDirection = to.anchor
      .clone()
      .sub(from.anchor)
      .setY(0);
    if (desiredDirection.lengthSq() < 1e-6) {
      desiredDirection.set(0, 0, -1);
    }
    desiredDirection.normalize();

    const candidates: THREE.Vector3[] = [];
    for (const perimeter of surface.perimeterCornerWaypoints(from.source.id)) {
      perimeter.y = from.floorY + 0.98;
      const offset = perimeter.clone().sub(landing).setY(0);
      const perimeterDistance = offset.length();
      if (perimeterDistance < 4.5) continue;
      offset.normalize();
      for (const distance of [4.5, 5.75, 7, 8.5, 10]) {
        if (distance >= perimeterDistance - 0.5) continue;
        const candidate = landing.clone().addScaledVector(offset, distance);
        if (
          !surface.containsCapsuleInRoom(
            from.source.id,
            candidate,
            PLAYER_CAPSULE_RADIUS,
          ) ||
          !surface.containsCapsuleSegmentInRoom(
            from.source.id,
            landing,
            candidate,
            PLAYER_CAPSULE_RADIUS,
          )
        ) {
          continue;
        }
        if (
          candidates.some(
            (existing) =>
              existing.distanceToSquared(candidate) < 0.25 * 0.25,
          )
        ) {
          continue;
        }
        candidates.push(candidate);
      }
    }

    const existing = this.terminals.filter(
      (terminal) => terminal.fromRoomId === from.source.id,
    );
    candidates.sort((left, right) => {
      const leftOffset = left.clone().sub(landing).setY(0);
      const rightOffset = right.clone().sub(landing).setY(0);
      const leftDirectionScore =
        leftOffset.lengthSq() > 1e-6
          ? leftOffset.normalize().dot(desiredDirection)
          : -1;
      const rightDirectionScore =
        rightOffset.lengthSq() > 1e-6
          ? rightOffset.normalize().dot(desiredDirection)
          : -1;
      if (Math.abs(leftDirectionScore - rightDirectionScore) > 1e-6) {
        return rightDirectionScore - leftDirectionScore;
      }
      return left.distanceToSquared(landing) - right.distanceToSquared(landing);
    });
    return (
      candidates.find((candidate) =>
        existing.every(
          (terminal) =>
            terminal.position.distanceTo(candidate) >=
            MINIMUM_TERMINAL_SEPARATION,
        ),
      )?.clone() ?? null
    );
  }

  private createMarker(shortLabel: string): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: 0xb8ff3d,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.045, 8, 32),
      material,
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const innerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.025, 8, 28),
      material.clone(),
    );
    innerRing.rotation.x = Math.PI / 2;
    innerRing.position.y = 0.025;
    group.add(innerRing);

    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.08, 1.7, 8, 1, true),
      material.clone(),
    );
    beacon.position.y = 0.85;
    group.add(beacon);

    group.userData.roomTransitLabel = shortLabel;
    return group;
  }

  private resolveNavigationTarget(
    currentRoomId: string,
    goalRoomId: string,
  ): {
    id: string;
    kind: 'power' | 'door' | 'relay';
    roomId: string;
    label: string;
    position: THREE.Vector3;
    radius: number;
    available: boolean;
    requirement: string | null;
  } | null {
    if (!this.powerOn) {
      const power = this.powerSwitch;
      if (!power || power.roomId !== currentRoomId) return null;
      return {
        id: 'power-switch',
        kind: 'power',
        roomId: power.roomId,
        label: 'Restore power',
        position: power.position,
        radius: 2.3,
        available: true,
        requirement: null,
      };
    }

    const goalPath = this.findPath(currentRoomId, goalRoomId);
    const goalTerminals = this.terminalsForPath(goalPath);
    const locked = goalTerminals.find(
      (terminal) => !this.isTerminalAvailable(terminal),
    );
    if (locked) {
      const requiredDoorId = this.requiredDoorId(locked);
      const door = requiredDoorId
        ? this.progressionDoors.get(requiredDoorId)
        : null;
      if (!requiredDoorId || !door) return null;
      if (door.roomId === currentRoomId) {
        return {
          id: requiredDoorId,
          kind: 'door',
          roomId: door.roomId,
          label: `Open ${roomLabel(locked.toRoomId).label} route`,
          position: door.position,
          radius: 2.4,
          available: true,
          requirement: null,
        };
      }
      const routeToDoor = this.findPath(
        currentRoomId,
        door.roomId,
        (terminal) => this.isTerminalAvailable(terminal),
      );
      const nextDoorRoomId = routeToDoor[1];
      const routeTerminal = nextDoorRoomId
        ? this.terminals.find(
            (terminal) =>
              terminal.fromRoomId === currentRoomId &&
              terminal.toRoomId === nextDoorRoomId &&
              this.isTerminalAvailable(terminal),
          ) ?? null
        : null;
      return routeTerminal
        ? this.navigationTargetForTerminal(routeTerminal)
        : null;
    }

    const nextRoomId = goalPath[1];
    const terminal = nextRoomId
      ? this.terminals.find(
          (candidate) =>
            candidate.fromRoomId === currentRoomId &&
            candidate.toRoomId === nextRoomId &&
            this.isTerminalAvailable(candidate),
        ) ?? null
      : null;
    return terminal ? this.navigationTargetForTerminal(terminal) : null;
  }

  private navigationTargetForTerminal(terminal: TransitTerminal): {
    id: string;
    kind: 'relay';
    roomId: string;
    label: string;
    position: THREE.Vector3;
    radius: number;
    available: boolean;
    requirement: string | null;
  } {
    return {
      id: terminal.id,
      kind: 'relay',
      roomId: terminal.toRoomId,
      label: roomLabel(terminal.toRoomId).label,
      position: terminal.position,
      radius: INTERACTION_RADIUS,
      available: true,
      requirement: null,
    };
  }

  private requiredDoorId(terminal: TransitTerminal): string | null {
    return (
      LINK_DOOR_GATES.get(
        transitLinkKey(terminal.fromRoomId, terminal.toRoomId),
      ) ?? null
    );
  }

  private isTerminalAvailable(terminal: TransitTerminal): boolean {
    if (!this.powerOn) return false;
    const requiredDoorId = this.requiredDoorId(terminal);
    return !requiredDoorId || this.openDoorIds.has(requiredDoorId);
  }

  private terminalsForPath(path: readonly string[]): TransitTerminal[] {
    const terminals: TransitTerminal[] = [];
    for (let index = 0; index < path.length - 1; index += 1) {
      const terminal = this.terminals.find(
        (candidate) =>
          candidate.fromRoomId === path[index] &&
          candidate.toRoomId === path[index + 1],
      );
      if (terminal) terminals.push(terminal);
    }
    return terminals;
  }

  private hasClearPathFromRoomLanding(
    roomId: string,
    position: THREE.Vector3,
  ): boolean {
    const room = this.surface?.room(roomId);
    if (!room || !this.surface) return false;
    const landing = room.anchor.clone().setY(room.floorY + 0.98);
    return this.surface.containsCapsuleSegmentInRoom(
      roomId,
      landing,
      position,
      PLAYER_CAPSULE_RADIUS,
    );
  }

  private nearestTerminalDistance(terminal: TransitTerminal): number | null {
    let nearest = Infinity;
    for (const candidate of this.terminals) {
      if (
        candidate === terminal ||
        candidate.fromRoomId !== terminal.fromRoomId
      ) {
        continue;
      }
      nearest = Math.min(
        nearest,
        candidate.position.distanceTo(terminal.position),
      );
    }
    return Number.isFinite(nearest) ? nearest : null;
  }

  private findPath(
    fromRoomId: string,
    toRoomId: string,
    allow: (terminal: TransitTerminal) => boolean = () => true,
  ): string[] {
    if (fromRoomId === toRoomId) return [fromRoomId];
    const queue: string[][] = [[fromRoomId]];
    const seen = new Set<string>([fromRoomId]);
    while (queue.length > 0) {
      const path = queue.shift()!;
      const current = path[path.length - 1]!;
      const neighbors = this.terminals
        .filter(
          (terminal) =>
            terminal.fromRoomId === current && allow(terminal),
        )
        .map((terminal) => terminal.toRoomId);
      for (const neighbor of neighbors) {
        if (seen.has(neighbor)) continue;
        const next = [...path, neighbor];
        if (neighbor === toRoomId) return next;
        seen.add(neighbor);
        queue.push(next);
      }
    }
    return [];
  }
}
