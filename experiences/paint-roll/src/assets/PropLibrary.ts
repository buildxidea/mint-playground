import {
  Group,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  type Texture,
} from 'three';
import registry from '../../mint-assets.json';
import { createMintGltfLoader } from './gltf-runtime';

type ArtifactRecord = { runtimeUrl: string };
type AssetRecord = { artifacts: Record<string, ArtifactRecord> };
const ASSETS = registry.assets as unknown as Record<string, AssetRecord>;

function artifactUrl(key: string, artifactId: string): string | null {
  return ASSETS[key]?.artifacts?.[artifactId]?.runtimeUrl ?? null;
}

const textureLoader = new TextureLoader();
const textureCache = new Map<string, Promise<Texture>>();

function loadTexture(url: string, colorSpace: string): Promise<Texture> {
  const cacheKey = `${url}|${colorSpace}`;
  let pending = textureCache.get(cacheKey);
  if (!pending) {
    pending = textureLoader.loadAsync(url).then((texture) => {
      texture.colorSpace = colorSpace as typeof SRGBColorSpace;
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.anisotropy = 8;
      return texture;
    });
    textureCache.set(cacheKey, pending);
  }
  return pending;
}

export class AssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetError';
  }
}

/**
 * Builds a wall material from a Mint PBR map set.
 *
 * The maps are used exactly as generated. The height map is registered but not
 * applied as displacement — the wall is a single quad, so displacing it would
 * only distort the paint UVs for no visual gain.
 */
export async function loadWallMaterial(
  key: string,
  options: { wallWidth: number; wallHeight: number; textureMetres: number },
): Promise<MeshStandardMaterial> {
  const baseColorUrl = artifactUrl(key, 'map_basecolor');
  if (!baseColorUrl) {
    throw new AssetError(
      `Wall material "${key}" is not registered in mint-assets.json.`,
    );
  }

  const normalUrl = artifactUrl(key, 'map_normal');
  const roughnessUrl = artifactUrl(key, 'map_roughness');
  const metalnessUrl = artifactUrl(key, 'map_metalness');

  const [map, normalMap, roughnessMap, metalnessMap] = await Promise.all([
    loadTexture(baseColorUrl, SRGBColorSpace),
    normalUrl ? loadTexture(normalUrl, LinearSRGBColorSpace) : null,
    roughnessUrl ? loadTexture(roughnessUrl, LinearSRGBColorSpace) : null,
    metalnessUrl ? loadTexture(metalnessUrl, LinearSRGBColorSpace) : null,
  ]);

  const repeatX = options.wallWidth / options.textureMetres;
  const repeatY = options.wallHeight / options.textureMetres;

  // Textures are shared through the cache, so each wall gets its own clone to
  // carry its own repeat without stamping on another level's tiling.
  const tile = (texture: Texture | null): Texture | null => {
    if (!texture) return null;
    const clone = texture.clone();
    clone.needsUpdate = true;
    clone.wrapS = RepeatWrapping;
    clone.wrapT = RepeatWrapping;
    clone.repeat.set(repeatX, repeatY);
    return clone;
  };

  const material = new MeshStandardMaterial({
    map: tile(map),
    normalMap: tile(normalMap),
    roughnessMap: tile(roughnessMap),
    metalnessMap: tile(metalnessMap),
    roughness: 1,
    metalness: metalnessMap ? 1 : 0,
  });
  if (material.normalMap) material.normalScale = new Vector2(1, 1);

  return material;
}

const modelCache = new Map<string, Promise<Group>>();

/** Every Mint GLB load in the project goes through here. */
export async function loadModel(key: string): Promise<Group> {
  let pending = modelCache.get(key);
  if (!pending) {
    const url =
      artifactUrl(key, 'optimized_glb') ?? artifactUrl(key, 'original_glb');
    if (!url) {
      throw new AssetError(
        `Model "${key}" is not registered in mint-assets.json.`,
      );
    }
    const loader = createMintGltfLoader();
    pending = loader.loadAsync(url).then((gltf) => gltf.scene);
    modelCache.set(key, pending);
  }
  // Each caller gets its own instance; the parse is what we are caching.
  return (await pending).clone(true);
}
