export type MapsMintRuntime = {
  mintUrl?: string;
  runtimeUrl: string;
  colliderUrl: string;
  byteSize: number;
  assetId: string;
};

type MintStreamManifest = {
  integrationMode?: unknown;
  mintUrl?: unknown;
  assetId?: unknown;
  source?: {
    assetType?: unknown;
    id?: unknown;
  };
  runtime?: {
    format?: unknown;
    runtimeUrl?: unknown;
    byteSize?: unknown;
    collider?: {
      format?: unknown;
      runtimeUrl?: unknown;
    };
  };
};

function requireUrl(
  value: unknown,
  hostname: string,
  suffix: string,
  label: string,
): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} is missing from the Mint manifest.`);
  }
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== hostname ||
    (suffix && !url.pathname.endsWith(suffix))
  ) {
    throw new Error(`${label} is not a finalized Mint ${suffix || hostname} artifact.`);
  }
  return value;
}

function requireAssetId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('The Mint asset identifier is missing.');
  }
  const assetId = value.trim();
  if (assetId.length < 2 || assetId.length > 200) {
    throw new Error('The Mint asset identifier is invalid.');
  }
  return assetId;
}

/** Parse + gate a Mint remote_stream world manifest for Maps Outbreak install. */
export function parseMapsMintManifest(input: unknown): MapsMintRuntime {
  if (!input || typeof input !== 'object') {
    throw new Error('The Mint stream manifest must be an object.');
  }
  const manifest = input as MintStreamManifest;
  if (manifest.integrationMode !== 'remote_stream') {
    throw new Error('Mint must finalize the world for remote streaming.');
  }
  if (
    !manifest.runtime ||
    manifest.runtime.format !== 'rad' ||
    manifest.runtime.collider?.format !== 'glb'
  ) {
    throw new Error('Mint must provide a paired RAD world and GLB collider.');
  }

  const byteSize = Number(manifest.runtime.byteSize);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new Error('The Mint RAD artifact byte size is invalid.');
  }

  const assetId = requireAssetId(
    manifest.assetId ??
      (typeof manifest.source?.id === 'string' ? manifest.source.id : undefined),
  );

  return {
    ...(typeof manifest.mintUrl === 'string'
      ? { mintUrl: requireUrl(manifest.mintUrl, 'mint.gg', '', 'Mint asset URL') }
      : {}),
    runtimeUrl: requireUrl(
      manifest.runtime.runtimeUrl,
      'cdn.mint.gg',
      '-lod.rad',
      'RAD runtime URL',
    ),
    colliderUrl: requireUrl(
      manifest.runtime.collider.runtimeUrl,
      'cdn.mint.gg',
      '.glb',
      'Collider URL',
    ),
    byteSize,
    assetId,
  };
}

export type MapsMintCdnCheck = {
  ok: boolean;
  errors: string[];
  radStatus?: number;
  colliderStatus?: number;
  checkedAt: number;
};

export async function verifyMapsMintCdn(
  runtime: MapsMintRuntime,
  fetchImpl: typeof fetch = fetch,
): Promise<MapsMintCdnCheck> {
  const errors: string[] = [];
  const checkedAt = Date.now();
  let radStatus: number | undefined;
  let colliderStatus: number | undefined;

  try {
    const rad = await fetchImpl(runtime.runtimeUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-15' },
      mode: 'cors',
      credentials: 'omit',
    });
    radStatus = rad.status;
    if (!(rad.status === 200 || rad.status === 206)) {
      errors.push(`RAD CDN returned ${rad.status}`);
    }
  } catch (error) {
    errors.push(
      `RAD CDN check failed: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }

  try {
    const collider = await fetchImpl(runtime.colliderUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-3' },
      mode: 'cors',
      credentials: 'omit',
    });
    colliderStatus = collider.status;
    if (!(collider.status === 200 || collider.status === 206)) {
      errors.push(`Collider CDN returned ${collider.status}`);
    } else {
      const header = new Uint8Array(await collider.arrayBuffer());
      const magic = String.fromCharCode(...header.slice(0, 4));
      if (magic !== 'glTF') {
        errors.push('Collider is not a GLB (missing glTF magic)');
      }
    }
  } catch (error) {
    errors.push(
      `Collider CDN check failed: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }

  return { ok: errors.length === 0, errors, radStatus, colliderStatus, checkedAt };
}
