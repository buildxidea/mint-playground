import {
  listFeaturedMapsArenas,
  type MapsCatalogEntry,
} from './mapsCatalog';
import type { MapsMintRuntime } from './mapsMintManifest';
import { warmPagedRadHeader } from '../world/RadRangeRequest';

/** Cache API bucket for featured collider files and camera-selected RAD ranges. */
export const MAPS_FEATURED_CACHE_NAME = 'maps-outbreak-featured-v2';

export const MAPS_FEATURED_SW_URL = '/maps-featured-cache-sw.js';

export type MapsPrefetchTarget = {
  /** Stable id used for cancel / UI warming state (catalog id or assetId). */
  key: string;
  title?: string;
  runtimeUrl: string;
  colliderUrl: string;
  byteSize?: number;
  /** Persist full responses into Cache API (featured arenas only). */
  persistToCacheApi?: boolean;
};

export type MapsPrefetchResult = {
  ok: boolean;
  key: string;
  cancelled: boolean;
  fromCache: boolean;
  radBytes: number;
  colliderBytes: number;
  error?: string;
};

export type MapsPrefetchStatus = {
  key: string | null;
  title: string | null;
  state: 'idle' | 'warming' | 'ready' | 'error';
  error: string | null;
};

type ActiveJob = {
  key: string;
  title: string | null;
  runtimeUrl: string;
  colliderUrl: string;
  controller: AbortController;
  promise: Promise<MapsPrefetchResult>;
};

let activeJob: ActiveJob | null = null;
let lastStatus: MapsPrefetchStatus = {
  key: null,
  title: null,
  state: 'idle',
  error: null,
};
const readyKeys = new Set<string>();
const readyRuntimeUrls = new Set<string>();
let serviceWorkerPromise: Promise<boolean> | null = null;

function runtimeWarmKey(runtimeUrl: string, colliderUrl: string): string {
  return `${runtimeUrl}\0${colliderUrl}`;
}

export function mapsOutbreakPrefetchStatus(): MapsPrefetchStatus {
  return { ...lastStatus };
}

export function mapsOutbreakPrefetchReadyKeys(): ReadonlySet<string> {
  return readyKeys;
}

export function isMapsOutbreakPrefetchWarming(key?: string): boolean {
  if (!activeJob) return false;
  return key ? activeJob.key === key : true;
}

export function cancelMapsOutbreakPrefetch(): void {
  if (!activeJob) return;
  activeJob.controller.abort();
  activeJob = null;
  if (lastStatus.state === 'warming') {
    lastStatus = {
      key: lastStatus.key,
      title: lastStatus.title,
      state: 'idle',
      error: null,
    };
  }
}

export function featuredPrefetchTargets(
  entries: MapsCatalogEntry[] = listFeaturedMapsArenas(),
): MapsPrefetchTarget[] {
  return entries.map((entry) => ({
    key: `featured:${entry.id}`,
    title: entry.title,
    runtimeUrl: entry.runtime.runtimeUrl,
    colliderUrl: entry.runtime.colliderUrl,
    byteSize: entry.runtime.byteSize,
    persistToCacheApi: true,
  }));
}

export function draftPrefetchTarget(input: {
  draftId: string;
  title: string;
  runtime: MapsMintRuntime;
}): MapsPrefetchTarget {
  return {
    key: `draft:${input.draftId}`,
    title: input.title,
    runtimeUrl: input.runtime.runtimeUrl,
    colliderUrl: input.runtime.colliderUrl,
    byteSize: input.runtime.byteSize,
    persistToCacheApi: false,
  };
}

export function runtimePrefetchTarget(input: {
  key: string;
  title?: string;
  runtime: MapsMintRuntime;
  persistToCacheApi?: boolean;
}): MapsPrefetchTarget {
  return {
    key: input.key,
    title: input.title,
    runtimeUrl: input.runtime.runtimeUrl,
    colliderUrl: input.runtime.colliderUrl,
    byteSize: input.runtime.byteSize,
    persistToCacheApi: input.persistToCacheApi === true,
  };
}

/** Register the featured CDN cache service worker (idempotent). */
export function ensureMapsFeaturedServiceWorker(
  register: (
    scriptURL: string,
    options?: RegistrationOptions,
  ) => Promise<ServiceWorkerRegistration> = (scriptURL, options) =>
    navigator.serviceWorker.register(scriptURL, options),
): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(false);
  }
  if (!serviceWorkerPromise) {
    serviceWorkerPromise = register(MAPS_FEATURED_SW_URL, { scope: '/' })
      .then(async (registration) => {
        await navigator.serviceWorker.ready;
        registration.active?.postMessage({
          type: 'maps-featured-cache-name',
          cacheName: MAPS_FEATURED_CACHE_NAME,
        });
        return true;
      })
      .catch(() => {
        serviceWorkerPromise = null;
        return false;
      });
  }
  return serviceWorkerPromise;
}

async function cacheMatch(
  url: string,
): Promise<Response | undefined> {
  if (typeof caches === 'undefined') return undefined;
  const cache = await caches.open(MAPS_FEATURED_CACHE_NAME);
  return cache.match(url);
}

async function cachePut(url: string, response: Response): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(MAPS_FEATURED_CACHE_NAME);
  await cache.put(url, response);
}

async function warmCollider(
  url: string,
  signal: AbortSignal,
  persistToCacheApi: boolean,
): Promise<{ bytes: number; fromCache: boolean }> {
  if (persistToCacheApi) {
    const hit = await cacheMatch(url);
    if (hit) {
      const buffer = await hit.clone().arrayBuffer();
      return { bytes: buffer.byteLength, fromCache: true };
    }
  }

  const response = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'force-cache',
    signal,
  });
  if (!(response.ok || response.status === 206)) {
    throw new Error(`Prefetch failed (${response.status}) for ${url}`);
  }

  const clone = persistToCacheApi ? response.clone() : null;
  const buffer = await response.arrayBuffer();
  if (persistToCacheApi && clone && response.ok) {
    await cachePut(url, clone);
  }
  return { bytes: buffer.byteLength, fromCache: false };
}

/**
 * Cancel any in-flight warm and start a single Maps Outbreak RAD+collider warm.
 * Featured targets also populate Cache API for the service worker.
 * Same CDN URLs under a different key reuse the in-flight job (deploy must not
 * abort a featured warm of the identical RAD).
 */
export function prefetchMapsOutbreakRuntime(
  target: MapsPrefetchTarget,
): Promise<MapsPrefetchResult> {
  if (readyKeys.has(target.key) && !isMapsOutbreakPrefetchWarming(target.key)) {
    lastStatus = {
      key: target.key,
      title: target.title ?? null,
      state: 'ready',
      error: null,
    };
    return Promise.resolve({
      ok: true,
      key: target.key,
      cancelled: false,
      fromCache: true,
      radBytes: 0,
      colliderBytes: 0,
    });
  }

  if (
    activeJob &&
    (activeJob.key === target.key ||
      (activeJob.runtimeUrl === target.runtimeUrl &&
        activeJob.colliderUrl === target.colliderUrl))
  ) {
    return activeJob.promise;
  }

  const urlsKey = runtimeWarmKey(target.runtimeUrl, target.colliderUrl);
  if (readyRuntimeUrls.has(urlsKey)) {
    readyKeys.add(target.key);
    lastStatus = {
      key: target.key,
      title: target.title ?? null,
      state: 'ready',
      error: null,
    };
    return Promise.resolve({
      ok: true,
      key: target.key,
      cancelled: false,
      fromCache: true,
      radBytes: 0,
      colliderBytes: 0,
    });
  }

  cancelMapsOutbreakPrefetch();

  const controller = new AbortController();
  lastStatus = {
    key: target.key,
    title: target.title ?? null,
    state: 'warming',
    error: null,
  };

  const promise = (async (): Promise<MapsPrefetchResult> => {
    try {
      if (target.persistToCacheApi) {
        await ensureMapsFeaturedServiceWorker();
      }
      const persist = target.persistToCacheApi === true;
      // Collider first (small) so deploy nav bake can hit cache sooner. RAD
      // intent warming is metadata-only; Spark owns all camera-selected pages.
      const collider = await warmCollider(
        target.colliderUrl,
        controller.signal,
        persist,
      );
      const rad = await warmPagedRadHeader(target.runtimeUrl, {
        signal: controller.signal,
      });
      readyKeys.add(target.key);
      readyRuntimeUrls.add(
        runtimeWarmKey(target.runtimeUrl, target.colliderUrl),
      );
      lastStatus = {
        key: target.key,
        title: target.title ?? null,
        state: 'ready',
        error: null,
      };
      return {
        ok: true,
        key: target.key,
        cancelled: false,
        fromCache: collider.fromCache,
        radBytes: rad.bytes,
        colliderBytes: collider.bytes,
      };
    } catch (error) {
      const cancelled =
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError');
      if (!cancelled) {
        lastStatus = {
          key: target.key,
          title: target.title ?? null,
          state: 'error',
          error: error instanceof Error ? error.message : 'Prefetch failed',
        };
      }
      return {
        ok: false,
        key: target.key,
        cancelled,
        fromCache: false,
        radBytes: 0,
        colliderBytes: 0,
        error: cancelled
          ? 'cancelled'
          : error instanceof Error
            ? error.message
            : 'Prefetch failed',
      };
    } finally {
      if (activeJob?.controller === controller) {
        activeJob = null;
      }
    }
  })();

  activeJob = {
    key: target.key,
    title: target.title ?? null,
    runtimeUrl: target.runtimeUrl,
    colliderUrl: target.colliderUrl,
    controller,
    promise,
  };
  return promise;
}

/** Warm featured catalog arenas one at a time (first entry highest priority). */
export async function prefetchFeaturedMapsArenas(
  entries: MapsCatalogEntry[] = listFeaturedMapsArenas(),
): Promise<MapsPrefetchResult[]> {
  const results: MapsPrefetchResult[] = [];
  for (const target of featuredPrefetchTargets(entries)) {
    results.push(await prefetchMapsOutbreakRuntime(target));
  }
  return results;
}

/** Parse a single `bytes=start-end` Range header for Cache API slicing. */
export function parseBytesRange(
  header: string | null,
  totalSize: number,
): { start: number; end: number } | null {
  if (!header || totalSize <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const startToken = match[1] ?? '';
  const endToken = match[2] ?? '';
  let start: number;
  let end: number;
  if (startToken === '' && endToken === '') return null;
  if (startToken === '') {
    const suffix = Number(endToken);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = Number(startToken);
    end = endToken === '' ? totalSize - 1 : Number(endToken);
  }
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= totalSize
  ) {
    return null;
  }
  return { start, end: Math.min(end, totalSize - 1) };
}
