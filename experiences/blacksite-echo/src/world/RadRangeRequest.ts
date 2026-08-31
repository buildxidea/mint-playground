/** Spark's first RAD metadata request. Keep manual intent warming identical. */
export const RAD_HEADER_RANGE_BYTES = 64 * 1024;
export const RAD_HEADER_RANGE = `bytes=0-${RAD_HEADER_RANGE_BYTES - 1}`;

export type PagedRadWarmResult = {
  bytes: number;
  totalBytes: number | null;
};

/**
 * Warm only the RAD metadata prefix. A host that ignores Range is rejected so
 * this path can never silently turn into a full-file splat download.
 */
export async function warmPagedRadHeader(
  url: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<PagedRadWarmResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'force-cache',
    headers: { Range: RAD_HEADER_RANGE },
    signal: options.signal,
  });
  const contentRange = response.headers.get('Content-Range');
  const match = /^bytes\s+0-(\d+)\/(\d+|\*)$/i.exec(contentRange ?? '');
  const expectedEnd = RAD_HEADER_RANGE_BYTES - 1;
  if (response.status !== 206 || !match || Number(match[1]) !== expectedEnd) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `RAD host must honor ${RAD_HEADER_RANGE} with 206 Content-Range`,
    );
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== RAD_HEADER_RANGE_BYTES) {
    throw new Error(
      `RAD header range returned ${bytes.byteLength} bytes; expected ${RAD_HEADER_RANGE_BYTES}`,
    );
  }
  const totalToken = match[2]!;
  return {
    bytes: bytes.byteLength,
    totalBytes: totalToken === '*' ? null : Number(totalToken),
  };
}
