import {
  BackSide,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from "three";
import { getArtifactUrl, getAsset, hasAsset } from "../assets/registry";

/**
 * The distant mountain horizon.
 *
 * A cylinder, not a sphere: the generated panorama only needs to look right
 * along the horizon band a pilot actually sees, and a cylinder has no polar
 * distortion to fight there, unlike a sphere's texture wrapping at the poles.
 * Nothing overhead or underfoot needs mountains — `world/scene.ts`'s sky
 * colour and ground already cover those.
 *
 * A single 2D generation cannot guarantee its left and right edges match, so
 * wrapping it once around the cylinder leaves one visible seam. Left where
 * `CylinderGeometry`'s default UVs put it (`theta = 0`, world +Z) rather than
 * rotated to hide it: the aircraft spawns facing -Z and the chase camera
 * watches from +Z looking forward, which puts the seam directly behind the
 * camera and the clean centre of the panorama dead ahead — confirmed by
 * ray-intersecting the cylinder in both directions, not assumed from the UV
 * math alone.
 *
 * Purely decorative: no collider, well outside the yard and every prop, and
 * far enough inside the camera's far plane (2000 m, `core/engine.ts`) to
 * never clip.
 */

/** Distance from the origin to the mountain band, metres. */
export const BACKDROP_RADIUS = 1000;
/** Vertical span of the textured band, metres — well above any normal flight
 * ceiling and comfortably below the ground plane, so nothing pierces it. */
const BACKDROP_BOTTOM = -60;
const BACKDROP_TOP = 500;

export async function loadBackdrop(scene: Scene): Promise<Mesh | null> {
  const key = "sky-backdrop";
  if (!hasAsset(key)) return null;

  const artifact = Object.values(getAsset(key).artifacts).find(
    (a) => a.loaderHint === "image",
  );
  if (!artifact) return null;

  const texture: Texture = await new TextureLoader().loadAsync(
    getArtifactUrl(artifact),
  );
  texture.colorSpace = SRGBColorSpace;
  // Wraps exactly once around the cylinder — the panorama was generated to
  // tile seamlessly left-to-right, so one full wrap is the whole point.
  texture.wrapS = RepeatWrapping;
  texture.repeat.x = 1;

  const height = BACKDROP_TOP - BACKDROP_BOTTOM;
  const geometry = new CylinderGeometry(
    BACKDROP_RADIUS,
    BACKDROP_RADIUS,
    height,
    64,
    1,
    true, // open-ended: no caps, so the sky colour shows above and below
  );
  geometry.translate(0, BACKDROP_BOTTOM + height / 2, 0);

  const material = new MeshBasicMaterial({
    map: texture,
    side: BackSide,
    // The panorama already paints in its own atmospheric haze at this
    // distance; the gameplay fog is tuned for the ~150 m yard and would just
    // wash the whole backdrop out to a flat wall of colour at 1000 m.
    fog: false,
    toneMapped: false,
  });

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}
