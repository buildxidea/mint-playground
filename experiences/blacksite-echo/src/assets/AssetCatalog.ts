import manifest from './mint-manifest.json';

export type AssetStatus = 'mint' | 'placeholder';

export type AssetCatalogEntry = {
  id: string;
  surface: string;
  desiredPath: string;
  status: AssetStatus;
  fallback: string;
};

export const MINT_MANIFEST = manifest;

export const ASSET_CATALOG: AssetCatalogEntry[] = [
  {
    id: 'weapons-six-platforms',
    surface: 'Six weapon platforms and modular attachments',
    desiredPath: '/assets/mint/weapons/',
    status: 'mint',
    fallback: 'Disabled by productionPolicy; missing Mint assets remain absent',
  },
  {
    id: 'first-person-arms',
    surface: 'First-person arms and handling clips',
    desiredPath: '/assets/mint/characters/first-person-arms.glb',
    status: 'mint',
    fallback: 'Disabled by productionPolicy; missing Mint assets remain absent',
  },
  {
    id: 'enemy-squad',
    surface: 'Three enemy soldier variants and rifle-combat clips',
    desiredPath: '/assets/mint/characters/enemies/',
    status: 'mint',
    fallback: 'Disabled by productionPolicy; deterministic hitboxes remain invisible',
  },
  {
    id: 'facility-kit',
    surface: 'Modular underground facility and extraction kit',
    desiredPath: '/assets/mint/environment/',
    status: 'mint',
    fallback: 'Disabled by productionPolicy; physics proxies remain invisible',
  },
  {
    id: 'pbr-material-kit',
    surface: 'Concrete, steel, polymer, rubber, fabric, glass, wet floor, damage',
    desiredPath: '/assets/mint/materials/',
    status: 'mint',
    fallback: 'Disabled by productionPolicy',
  },
  {
    id: 'mission-imagery',
    surface: 'Key art, tactical map, insignia, signs, weapon thumbnails',
    desiredPath: '/assets/mint/images/',
    status: 'mint',
    fallback: 'Disabled by productionPolicy',
  },
  {
    id: 'audio-suite',
    surface: 'Ambience, weapons, impacts, movement, enemy and mission cues',
    desiredPath: '/assets/mint/audio/',
    status: 'mint',
    fallback: 'Disabled by productionPolicy; missing events are silent and diagnostic',
  },
];

export function getAssetStatus(id: string): AssetStatus {
  return ASSET_CATALOG.find((entry) => entry.id === id)?.status ?? 'placeholder';
}

export function hasFinalMintWorld(): boolean {
  const manifest = MINT_MANIFEST as unknown as {
    world?: {
      role?: string;
      status?: string;
      integrationMode?: string;
      runtime?: {
        runtimeUrl?: string;
        collider?: { runtimeUrl?: string };
      };
    } | null;
    worlds?: Array<{
      role?: string;
      status?: string;
      integrationMode?: string;
      runtime?: {
        runtimeUrl?: string;
        collider?: { runtimeUrl?: string };
      };
    }>;
  };
  const worlds = manifest.worlds?.length
    ? manifest.worlds
    : manifest.world
      ? [manifest.world]
      : [];
  return worlds.some(
    (world) =>
      (world.role === 'mission' || world.role === undefined) &&
      world.status === 'final' &&
      world.integrationMode === 'remote_stream' &&
      Boolean(world.runtime?.runtimeUrl) &&
      Boolean(world.runtime?.collider?.runtimeUrl),
  );
}
