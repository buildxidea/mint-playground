import type { RoomId } from '../config/catalog';

export type MintWorldId = RoomId | 'outdoor-freeplay';

export type MintWorldRuntimeManifest = {
  roomId: MintWorldId;
  mintWorldAssetId: string;
  integrationMode: 'remote_stream';
  runtime: {
    runtimeUrl: string;
    collider: {
      runtimeUrl: string;
    };
  };
  rootTransform: {
    position: [number, number, number];
    rotation: [number, number, number];
    uniformScale: number;
  };
  visualTransform?: {
    position: [number, number, number];
    rotation: [number, number, number];
    uniformScale: number;
  };
};

const WORLD_IDS = new Set<MintWorldId>([
  'kinetic-hall',
  'precision-cell',
  'crisis-bay',
  'outdoor-freeplay',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireVector3(value: unknown, field: string): [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((component) => typeof component === 'number' && Number.isFinite(component))
  ) {
    throw new Error(`${field} must contain exactly three finite numbers`);
  }
  return value as [number, number, number];
}

function requireHttpsUrl(value: unknown, field: string): string {
  const rawUrl = requireNonEmptyString(value, field);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${field} must be a valid absolute URL`);
  }

  const isLocalDevelopment = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const validProtocol =
    url.protocol === 'https:' || (url.protocol === 'http:' && isLocalDevelopment);
  if (!validProtocol) {
    throw new Error(`${field} must use HTTPS, except HTTP on localhost`);
  }
  return url.href;
}

/**
 * Treat Mint manifests as untrusted network input even when their TypeScript
 * call site is typed. This parser is the production gate before any RAD or
 * collider request is started.
 */
export function parseMintWorldRuntimeManifest(value: unknown): MintWorldRuntimeManifest {
  const manifest = requireRecord(value, 'manifest');
  const roomId = requireNonEmptyString(manifest.roomId, 'roomId');
  if (!WORLD_IDS.has(roomId as MintWorldId)) {
    throw new Error(`roomId is not a PROJECT FORGE-5 room or World: ${roomId}`);
  }

  const mintWorldAssetId = requireNonEmptyString(manifest.mintWorldAssetId, 'mintWorldAssetId');
  if (manifest.integrationMode !== 'remote_stream') {
    throw new Error('Mint World manifest must use remote_stream integration');
  }

  const runtime = requireRecord(manifest.runtime, 'runtime');
  const collider = requireRecord(runtime.collider, 'runtime.collider');
  const rootTransform = requireRecord(manifest.rootTransform, 'rootTransform');
  const uniformScale = rootTransform.uniformScale;
  if (typeof uniformScale !== 'number' || !Number.isFinite(uniformScale) || uniformScale <= 0) {
    throw new Error('rootTransform.uniformScale must be a positive finite number');
  }

  const visualTransform = manifest.visualTransform
    ? requireRecord(manifest.visualTransform, 'visualTransform')
    : null;
  const visualUniformScale = visualTransform?.uniformScale;
  if (
    visualTransform &&
    (typeof visualUniformScale !== 'number' ||
      !Number.isFinite(visualUniformScale) ||
      visualUniformScale <= 0)
  ) {
    throw new Error('visualTransform.uniformScale must be a positive finite number');
  }

  return {
    roomId: roomId as MintWorldId,
    mintWorldAssetId,
    integrationMode: 'remote_stream',
    runtime: {
      runtimeUrl: requireHttpsUrl(runtime.runtimeUrl, 'runtime.runtimeUrl'),
      collider: {
        runtimeUrl: requireHttpsUrl(collider.runtimeUrl, 'runtime.collider.runtimeUrl'),
      },
    },
    rootTransform: {
      position: requireVector3(rootTransform.position, 'rootTransform.position'),
      rotation: requireVector3(rootTransform.rotation, 'rootTransform.rotation'),
      uniformScale,
    },
    ...(visualTransform
      ? {
          visualTransform: {
            position: requireVector3(visualTransform.position, 'visualTransform.position'),
            rotation: requireVector3(visualTransform.rotation, 'visualTransform.rotation'),
            uniformScale: visualUniformScale as number,
          },
        }
      : {}),
  };
}
