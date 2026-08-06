import {
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
} from "three";

/** Half-width of the paved city ground, metres. */
export const GROUND_HALF_EXTENT = 400;

/** Half-width of the scale-reference grid near the pad, metres. */
const GRID_HALF_EXTENT = 60;

/** Radius of the landing pad at the origin, metres. */
export const PAD_RADIUS = 0.9;

/**
 * The flying area: ground, pad, lighting and atmosphere.
 *
 * Deliberately hand-built rather than generated. The ground needs an exact,
 * cheap collider and a readable scale reference underfoot; generated scenery
 * goes on top of it as props.
 */
export function buildWorld(scene: Scene) {
  scene.background = new Color(0x8ea2b4);
  // Fog far enough that the downtown skyline stays crisp from across the
  // city; the mountain backdrop opts out of fog entirely and is unaffected.
  scene.fog = new Fog(0x8ea2b4, 120, 950);

  // Everything ground-level lives in one group; lights stay on the scene.
  const yardGroup = new Group();
  scene.add(yardGroup);

  const ground = new Mesh(
    new PlaneGeometry(GROUND_HALF_EXTENT * 2, GROUND_HALF_EXTENT * 2),
    new MeshStandardMaterial({ color: 0x5b5f63, roughness: 0.96, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  yardGroup.add(ground);

  // A metre grid is the cheapest possible sense of scale and speed; without it
  // a hovering aircraft over a flat plane reads as motionless. Kept to the
  // blocks nearest the pad rather than the whole city.
  const grid = new GridHelper(GRID_HALF_EXTENT * 2, GRID_HALF_EXTENT * 2, 0x7a8288, 0x6a7076);
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  yardGroup.add(grid);

  const pad = new Mesh(
    new CircleGeometry(PAD_RADIUS, 48),
    new MeshStandardMaterial({ color: 0x2c3034, roughness: 0.8, metalness: 0.05 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.004;
  pad.receiveShadow = true;
  yardGroup.add(pad);

  const padRing = new Mesh(
    new CircleGeometry(PAD_RADIUS * 0.62, 48),
    new MeshStandardMaterial({ color: 0xd87a2e, roughness: 0.7 }),
  );
  padRing.rotation.x = -Math.PI / 2;
  padRing.position.y = 0.006;
  yardGroup.add(padRing);

  const sky = new HemisphereLight(0xc9dcea, 0x50565b, 1.5);
  scene.add(sky);

  const sun = new DirectionalLight(0xfff0dd, 2.4);
  sun.position.set(18, 26, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  const span = 24;
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  return { ground, sun, yardGroup };
}
