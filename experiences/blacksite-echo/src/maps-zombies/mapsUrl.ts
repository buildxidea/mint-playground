export type MapsStreetViewPose = {
  lat: number;
  lng: number;
  yaw: number | null;
  pitch: number | null;
  fov: number | null;
  panoid: string | null;
  thumbnailUrl: string | null;
  sourceUrl: string;
  locationLabel: string;
};

export type MapsUrlParseResult =
  | { ok: true; pose: MapsStreetViewPose }
  | { ok: false; error: string };

const STREET_VIEW_THUMB_HOST = 'streetviewpixels-pa.googleapis.com';

function clampFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function parseNumberParam(value: string | null): number | null {
  if (value == null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractFromDataBlob(data: string): {
  panoid: string | null;
  thumbnailUrl: string | null;
} {
  let panoid: string | null = null;
  const panoidMatch = data.match(/!1s([A-Za-z0-9_-]{10,})/);
  if (panoidMatch?.[1]) panoid = panoidMatch[1];

  let thumbnailUrl: string | null = null;
  const thumbMatch = data.match(/!6s(https?:[^!]+)/);
  if (thumbMatch?.[1]) {
    try {
      thumbnailUrl = decodeURIComponent(thumbMatch[1]);
    } catch {
      thumbnailUrl = thumbMatch[1];
    }
  }
  return { panoid, thumbnailUrl };
}

function extractAtCoords(pathname: string): {
  lat: number | null;
  lng: number | null;
  yaw: number | null;
  pitch: number | null;
  fov: number | null;
} {
  // @37.8081679,-122.4701725,3a,75y,115.06h,104.13t
  const match = pathname.match(
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,([^/?#]*))?/,
  );
  if (!match) {
    return { lat: null, lng: null, yaw: null, pitch: null, fov: null };
  }
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  const poseBlob = match[3] ?? '';
  const yawMatch = poseBlob.match(/(-?\d+(?:\.\d+)?)h/);
  const tiltMatch = poseBlob.match(/(-?\d+(?:\.\d+)?)t/);
  const fovMatch = poseBlob.match(/(-?\d+(?:\.\d+)?)y/);
  // Maps `t` is tilt (~90 = horizon). Convert to Street View thumbnail pitch.
  const tilt = tiltMatch ? Number(tiltMatch[1]) : null;
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    yaw: yawMatch ? Number(yawMatch[1]) : null,
    pitch: tilt != null && Number.isFinite(tilt) ? tilt - 90 : null,
    fov: fovMatch ? Number(fovMatch[1]) : null,
  };
}

function buildThumbnailFallback(pose: {
  panoid: string | null;
  yaw: number | null;
  pitch: number | null;
}): string | null {
  if (!pose.panoid) return null;
  const params = new URLSearchParams({
    cb_client: 'maps_sv.tactile',
    w: '900',
    h: '600',
    panoid: pose.panoid,
  });
  if (pose.yaw != null) params.set('yaw', String(pose.yaw));
  if (pose.pitch != null) params.set('pitch', String(pose.pitch));
  return `https://${STREET_VIEW_THUMB_HOST}/v1/thumbnail?${params.toString()}`;
}

function locationLabelFromCoords(lat: number, lng: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${ns}, ${Math.abs(lng).toFixed(4)}°${ew}`;
}

/**
 * Parse a Google Maps / Street View share URL into pose + thumbnail inputs
 * suitable for Mint world generation.
 */
export function parseGoogleMapsStreetViewUrl(raw: string): MapsUrlParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Paste a Google Maps Street View link.' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'That does not look like a valid URL.' };
  }

  const host = url.hostname.replace(/^www\./, '');
  if (
    host !== 'google.com' &&
    host !== 'maps.google.com' &&
    host !== 'maps.app.goo.gl' &&
    host !== 'goo.gl'
  ) {
    // Allow google.com/maps and regional hosts like google.co.uk/maps
    if (!host.endsWith('google.com') && !host.includes('google.')) {
      return {
        ok: false,
        error: 'Use a Google Maps or Street View link.',
      };
    }
  }

  const coords = extractAtCoords(`${url.pathname}${url.hash}`);
  const dataParam =
    url.searchParams.get('data') ??
    (url.pathname.includes('/data=')
      ? url.pathname.slice(url.pathname.indexOf('/data=') + '/data='.length)
      : '') +
      (url.search.startsWith('?') ? '' : '');

  // data often lives in the path: /maps/@.../data=!3m7!1e1...
  let dataBlob = '';
  const pathDataIndex = url.pathname.indexOf('/data=');
  if (pathDataIndex >= 0) {
    dataBlob = url.pathname.slice(pathDataIndex + '/data='.length);
  } else if (url.searchParams.has('data')) {
    dataBlob = url.searchParams.get('data') ?? '';
  } else {
    // Full URL may keep data after @... as path segment before query
    const loose = trimmed.match(/data=(!3m[\w%!._:~:/?#[\]@!$&'()*+,;=-]+)/i);
    if (loose?.[1]) dataBlob = loose[1];
  }

  const fromData = extractFromDataBlob(dataBlob || dataParam);

  const lat = coords.lat;
  const lng = coords.lng;
  if (lat == null || lng == null) {
    return {
      ok: false,
      error:
        'Could not read coordinates. Open Street View, then copy the browser URL.',
    };
  }

  // Street View marker: 3a in the pose blob, or panoid, or thumbnail host
  const isStreetView =
    /,\d+(?:\.\d+)?a,/.test(url.pathname) ||
    Boolean(fromData.panoid) ||
    Boolean(fromData.thumbnailUrl?.includes(STREET_VIEW_THUMB_HOST));

  if (!isStreetView) {
    return {
      ok: false,
      error:
        'That Maps link is not Street View. Enter Street View (pegman), then paste the URL.',
    };
  }

  try {
    const yaw = coords.yaw != null ? clampFinite(coords.yaw, 'yaw') : null;
    // Prefer pitch from thumbnail query if present
    let pitch = coords.pitch;
    let thumbnailUrl = fromData.thumbnailUrl;
    if (thumbnailUrl) {
      try {
        const thumb = new URL(thumbnailUrl);
        const thumbPitch = parseNumberParam(thumb.searchParams.get('pitch'));
        const thumbYaw = parseNumberParam(thumb.searchParams.get('yaw'));
        if (thumbPitch != null) pitch = thumbPitch;
        if (thumbYaw != null && yaw == null) {
          // keep coords yaw as primary
        }
        void thumbYaw;
      } catch {
        // keep extracted string
      }
    }
    if (!thumbnailUrl) {
      thumbnailUrl = buildThumbnailFallback({
        panoid: fromData.panoid,
        yaw,
        pitch,
      });
    }

    return {
      ok: true,
      pose: {
        lat: clampFinite(lat, 'lat'),
        lng: clampFinite(lng, 'lng'),
        yaw,
        pitch: pitch != null && Number.isFinite(pitch) ? pitch : null,
        fov: coords.fov != null && Number.isFinite(coords.fov) ? coords.fov : null,
        panoid: fromData.panoid,
        thumbnailUrl,
        sourceUrl: trimmed,
        locationLabel: locationLabelFromCoords(lat, lng),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to parse Maps URL.',
    };
  }
}
