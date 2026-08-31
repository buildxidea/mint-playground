import catalogJson from '../assets/maps-outbreak-catalog.json' with {
  type: 'json',
};
import {
  installMapsOutbreakRuntime,
  type MapsGenerateClientResult,
} from './mapsGenerateClient';
import type { MapsMintRuntime } from './mapsMintManifest';
import { MAPS_OUTBREAK_STYLE_VERSION } from './mapsWorldPrompt';

export type MapsCatalogEntry = {
  id: string;
  title: string;
  blurb: string;
  styleVersion: string;
  mapsUrl: string;
  chatUrl?: string;
  thumbnailUrl?: string;
  runtime: MapsMintRuntime;
};

export type MapsOutbreakCatalog = {
  version: number;
  featured: MapsCatalogEntry[];
};

function isRuntime(value: unknown): value is MapsMintRuntime {
  if (!value || typeof value !== 'object') return false;
  const runtime = value as Record<string, unknown>;
  return (
    typeof runtime.runtimeUrl === 'string' &&
    typeof runtime.colliderUrl === 'string' &&
    typeof runtime.byteSize === 'number' &&
    typeof runtime.assetId === 'string'
  );
}

export function parseMapsOutbreakCatalog(
  value: unknown = catalogJson,
): MapsOutbreakCatalog {
  if (!value || typeof value !== 'object') {
    throw new Error('Maps Outbreak catalog is missing.');
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) {
    throw new Error(`Unsupported Maps Outbreak catalog version ${String(raw.version)}`);
  }
  if (!Array.isArray(raw.featured) || raw.featured.length === 0) {
    throw new Error('Maps Outbreak catalog has no featured arenas.');
  }
  const featured: MapsCatalogEntry[] = [];
  for (const entry of raw.featured) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Maps Outbreak catalog entry is invalid.');
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id.trim()) {
      throw new Error('Maps Outbreak catalog entry is missing id.');
    }
    if (typeof record.title !== 'string' || !record.title.trim()) {
      throw new Error(`${record.id}: missing title`);
    }
    if (typeof record.mapsUrl !== 'string' || !record.mapsUrl.trim()) {
      throw new Error(`${record.id}: missing mapsUrl`);
    }
    if (!isRuntime(record.runtime)) {
      throw new Error(`${record.id}: missing Mint runtime`);
    }
    if (
      !record.runtime.runtimeUrl.includes('cdn.mint.gg') ||
      !record.runtime.colliderUrl.includes('cdn.mint.gg')
    ) {
      throw new Error(`${record.id}: runtime must use Mint CDN URLs`);
    }
    featured.push({
      id: record.id,
      title: record.title,
      blurb:
        typeof record.blurb === 'string' && record.blurb.trim()
          ? record.blurb
          : 'Shared Maps Outbreak arena.',
      styleVersion:
        typeof record.styleVersion === 'string'
          ? record.styleVersion
          : MAPS_OUTBREAK_STYLE_VERSION,
      mapsUrl: record.mapsUrl,
      thumbnailUrl:
        typeof record.thumbnailUrl === 'string'
          ? record.thumbnailUrl
          : undefined,
      runtime: record.runtime,
    });
  }
  return { version: 1, featured };
}

export function listFeaturedMapsArenas(): MapsCatalogEntry[] {
  return parseMapsOutbreakCatalog().featured;
}

export function getFeaturedMapsArena(id: string): MapsCatalogEntry | null {
  return listFeaturedMapsArenas().find((entry) => entry.id === id) ?? null;
}

/** Install a featured catalog arena into local drafts so Deploy/Play can run. */
export function installFeaturedMapsArena(
  id: string,
): MapsGenerateClientResult {
  const entry = getFeaturedMapsArena(id);
  if (!entry) {
    return { ok: false, error: `Featured arena not found: ${id}` };
  }
  return installMapsOutbreakRuntime({
    title: entry.title,
    mapsUrl: entry.mapsUrl,
    runtime: entry.runtime,
  });
}
