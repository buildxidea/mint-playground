import type { MintWorldRecord } from '../assets/MintAssetRuntime';
import type { ZombiesPlacementLayout } from '../zombies/ZombiesPlacementLayout';
import type { MapsMintRuntime } from './mapsMintManifest';
import {
  MAPS_ROOM_ID,
  buildMapsRingPlacementLayout,
  validateMapsPlacementLayout,
  type MapsPlayableBounds,
} from './MapsPlacement';

export type MapsSplatRoomLayout = {
  version: 1;
  status: 'maps-draft' | 'release-ready';
  coordinateSpace: 'mint-basis-corrected-local-metres';
  startRoomId: string;
  requiredRoomIds: string[];
  largestActorCapsuleRadius: number;
  portalSafetyMargin: number;
  rooms: Array<{
    id: string;
    assetId: string;
    transform: {
      position: [number, number, number];
      rotation: [number, number, number];
      scale: number;
      authoredYaw: number;
    };
    coverageReferenceScale: number;
    coveragePolygon: number[][];
  }>;
  connectors: [];
  cutVolumes: [];
  trimPlanes: [];
  portals: [];
};

export type MapsCampusPack = {
  id: string;
  kind: 'maps-single';
  roomId: string;
  world: MintWorldRecord;
  splatLayout: MapsSplatRoomLayout;
  placements: ZombiesPlacementLayout;
  playableBounds: MapsPlayableBounds;
};

const DEFAULT_COVERAGE: number[][] = [
  [-10, -10],
  [10, -10],
  [10, 10],
  [-10, 10],
];

export function buildMapsSplatLayout(input: {
  roomId?: string;
  assetId: string;
  coveragePolygon?: number[][];
}): MapsSplatRoomLayout {
  const roomId = input.roomId ?? MAPS_ROOM_ID;
  return {
    version: 1,
    status: 'maps-draft',
    coordinateSpace: 'mint-basis-corrected-local-metres',
    startRoomId: roomId,
    requiredRoomIds: [roomId],
    largestActorCapsuleRadius: 0.42,
    portalSafetyMargin: 0.18,
    rooms: [
      {
        id: roomId,
        assetId: input.assetId,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: 1,
          authoredYaw: 0,
        },
        coverageReferenceScale: 1,
        coveragePolygon: input.coveragePolygon ?? DEFAULT_COVERAGE,
      },
    ],
    connectors: [],
    cutVolumes: [],
    trimPlanes: [],
    portals: [],
  };
}

export function mintWorldRecordFromMapsRuntime(
  runtime: MapsMintRuntime,
): MintWorldRecord {
  return {
    id: MAPS_ROOM_ID,
    role: 'zombies',
    roomIndex: 0,
    status: 'final',
    integrationMode: 'remote_stream',
    runtime: {
      runtimeUrl: runtime.runtimeUrl,
      collider: {
        runtimeUrl: runtime.colliderUrl,
      },
    },
    metadata: {
      mapsOutbreak: true,
      sourceAssetId: runtime.assetId,
    },
  };
}

export function buildMapsCampusPack(input: {
  draftId: string;
  runtime: MapsMintRuntime;
  chatUrl?: string;
  playableBounds?: MapsPlayableBounds;
  placements?: ZombiesPlacementLayout;
}): MapsCampusPack {
  const playableBounds = input.playableBounds ?? {
    minX: -8,
    maxX: 8,
    minZ: -8,
    maxZ: 8,
    floorY: 0,
  };
  const placements =
    input.placements ?? buildMapsRingPlacementLayout(playableBounds);
  const validation = validateMapsPlacementLayout(placements);
  if (!validation.valid) {
    throw new Error(
      `Maps placement invalid: ${validation.errors.join('; ')}`,
    );
  }
  return {
    id: input.draftId,
    kind: 'maps-single',
    roomId: MAPS_ROOM_ID,
    world: mintWorldRecordFromMapsRuntime(input.runtime),
    splatLayout: buildMapsSplatLayout({
      assetId: MAPS_ROOM_ID,
      coveragePolygon: [
        [playableBounds.minX, playableBounds.minZ],
        [playableBounds.maxX, playableBounds.minZ],
        [playableBounds.maxX, playableBounds.maxZ],
        [playableBounds.minX, playableBounds.maxZ],
      ],
    }),
    placements,
    playableBounds,
  };
}
