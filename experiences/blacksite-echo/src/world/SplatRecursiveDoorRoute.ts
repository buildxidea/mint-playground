import type {
  SplatNavigationSurface,
  SplatWorldPortal,
} from './SplatNavigationSurface';

export type RecursiveDoorRouteOrder = 'ascending' | 'descending';

export type RecursiveDoorCrossing = {
  ordinal: number;
  depth: number;
  portalId: string;
  fromRoomId: string;
  toRoomId: string;
  directionKey: string;
  returnCrossing: boolean;
};

function destinationFrom(portal: SplatWorldPortal, roomId: string): string {
  if (portal.source.fromRoomId === roomId) return portal.source.toRoomId;
  if (portal.source.toRoomId === roomId) return portal.source.fromRoomId;
  throw new Error(`${portal.source.id} is not attached to ${roomId}`);
}

/**
 * Recursively traverses every undirected doorway once, then backtracks across
 * that same doorway. The resulting walk starts and ends in the requested room
 * and contains every directed doorway edge exactly once.
 */
export function buildRecursiveDoorRoute(
  surface: SplatNavigationSurface,
  startRoomId = surface.layout.startRoomId,
  order: RecursiveDoorRouteOrder = 'ascending',
): RecursiveDoorCrossing[] {
  if (!surface.room(startRoomId)) {
    throw new Error(`Unknown recursive-route start room ${startRoomId}`);
  }
  const coveredDoorways = new Set<string>();
  const crossings: RecursiveDoorCrossing[] = [];

  const append = (
    portal: SplatWorldPortal,
    fromRoomId: string,
    toRoomId: string,
    depth: number,
    returnCrossing: boolean,
  ) => {
    crossings.push({
      ordinal: crossings.length + 1,
      depth,
      portalId: portal.source.id,
      fromRoomId,
      toRoomId,
      directionKey: `${portal.source.id}:${fromRoomId}->${toRoomId}`,
      returnCrossing,
    });
  };

  const visit = (roomId: string, depth: number): void => {
    const attached = surface.portals
      .filter(
        (portal) =>
          portal.source.fromRoomId === roomId ||
          portal.source.toRoomId === roomId,
      )
      .sort((left, right) => left.source.id.localeCompare(right.source.id));
    if (order === 'descending') attached.reverse();

    for (const portal of attached) {
      if (coveredDoorways.has(portal.source.id)) continue;
      coveredDoorways.add(portal.source.id);
      const destinationId = destinationFrom(portal, roomId);
      append(portal, roomId, destinationId, depth, false);
      visit(destinationId, depth + 1);
      append(portal, destinationId, roomId, depth, true);
    }
  };

  visit(startRoomId, 0);
  if (coveredDoorways.size !== surface.portals.length) {
    const missing = surface.portals
      .filter((portal) => !coveredDoorways.has(portal.source.id))
      .map((portal) => portal.source.id);
    throw new Error(`Recursive route did not cover: ${missing.join(', ')}`);
  }
  return crossings;
}

export function expectedDirectedDoorKeys(
  surface: SplatNavigationSurface,
): string[] {
  return surface.portals
    .flatMap((portal) => [
      `${portal.source.id}:${portal.source.fromRoomId}->${portal.source.toRoomId}`,
      `${portal.source.id}:${portal.source.toRoomId}->${portal.source.fromRoomId}`,
    ])
    .sort();
}
