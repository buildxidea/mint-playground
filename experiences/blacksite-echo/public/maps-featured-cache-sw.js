/* Featured Maps Outbreak CDN cache.
 * Stores colliders normally and RAD ranges by exact Range key. Spark therefore
 * keeps camera-driven paging without requiring a complete RAD cache entry.
 */
const DEFAULT_CACHE_NAME = 'maps-outbreak-featured-v2';
let cacheName = DEFAULT_CACHE_NAME;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (
    data &&
    data.type === 'maps-featured-cache-name' &&
    typeof data.cacheName === 'string' &&
    data.cacheName.trim()
  ) {
    cacheName = data.cacheName.trim();
  }
});

function parseBytesRange(header, totalSize) {
  if (!header || totalSize <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
  if (!match) return null;
  const startToken = match[1] ?? '';
  const endToken = match[2] ?? '';
  let start;
  let end;
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

async function responseFromCache(request) {
  const cache = await caches.open(cacheName);
  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) {
    const separator = request.url.includes('?') ? '&' : '?';
    const rangeKey = `${request.url}${separator}__mint_rad_range=${encodeURIComponent(rangeHeader)}`;
    const cachedRange = await cache.match(rangeKey);
    if (cachedRange) {
      // CacheStorage rejects direct 206 writes. Range bodies are stored under
      // the synthetic key as cacheable 200s, then restored to the original
      // partial-response contract when Spark requests that exact interval.
      return new Response(cachedRange.body, {
        status: 206,
        statusText: 'Partial Content',
        headers: cachedRange.headers,
      });
    }

    // Support complete entries from the previous cache implementation, but do
    // not create new ones for RADs.
    const cachedFull = await cache.match(request.url);
    if (cachedFull) {
      const buffer = await cachedFull.arrayBuffer();
      const total = buffer.byteLength;
      const range = parseBytesRange(rangeHeader, total);
      if (!range) {
        return new Response(null, {
          status: 416,
          statusText: 'Range Not Satisfiable',
          headers: { 'Content-Range': `bytes */${total}` },
        });
      }
      const slice = buffer.slice(range.start, range.end + 1);
      const headers = new Headers(cachedFull.headers);
      headers.set('Content-Length', String(slice.byteLength));
      headers.set(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${total}`,
      );
      headers.set('Accept-Ranges', 'bytes');
      return new Response(slice, {
        status: 206,
        statusText: 'Partial Content',
        headers,
      });
    }

    const network = await fetch(request);
    if (network.status === 206) {
      try {
        const body = await network.clone().arrayBuffer();
        await cache.put(
          rangeKey,
          new Response(body, {
            status: 200,
            headers: network.headers,
          }),
        );
      } catch {
        // Quota/private-mode cache failures must not block the live RAD range.
      }
    }
    return network;
  }

  return (await cache.match(request.url)) ?? fetch(request);
}

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (!url.startsWith('https://cdn.mint.gg/')) return;
  if (event.request.method !== 'GET') return;
  event.respondWith(responseFromCache(event.request));
});
