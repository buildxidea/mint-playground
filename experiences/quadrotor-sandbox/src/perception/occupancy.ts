import {
  BoxGeometry,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  Matrix4,
  Vector3,
} from "three";

/**
 * A coarse occupancy grid built from lidar returns.
 *
 * This is the map the aircraft has actually *earned*: cells start unknown and
 * only light up once a beam has come back from them. Flying a circuit and
 * watching the yard fill in is the clearest demonstration that the perception
 * layer is sensing rather than reading the scene graph.
 *
 * Cells are keyed by integer grid coordinates in a Set, so a return that lands
 * in an already-known cell costs a hash lookup and nothing more — important
 * when the sensor is producing hundreds of returns a second.
 */

/** Edge length of one cell, metres. */
const CELL = 1.5;
/** Ceiling on drawn cells; the yard cannot produce more than this in practice. */
const MAX_CELLS = 4096;
/** Returns below this height are ground clutter and are not mapped. */
const GROUND_BAND = 0.45;

export class OccupancyGrid {
  readonly mesh: InstancedMesh;
  enabled = true;

  private readonly known = new Set<number>();
  private readonly matrix = new Matrix4();
  private readonly cellPosition = new Vector3();
  private count = 0;

  constructor() {
    const geometry = new BoxGeometry(CELL * 0.82, CELL * 0.82, CELL * 0.82);
    const material = new MeshBasicMaterial({
      color: new Color(0x4ea8d8),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });

    this.mesh = new InstancedMesh(geometry, material, MAX_CELLS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Number of cells mapped so far. */
  get cellCount() {
    return this.count;
  }

  reset() {
    this.known.clear();
    this.count = 0;
    this.mesh.count = 0;
  }

  /** Record a sensor return. Cheap to call for every ray hit. */
  mark(point: Vector3) {
    if (!this.enabled || this.count >= MAX_CELLS) return;
    if (point.y < GROUND_BAND) return;

    const ix = Math.floor(point.x / CELL);
    const iy = Math.floor(point.y / CELL);
    const iz = Math.floor(point.z / CELL);

    // Pack three signed grid indices into one integer key. The yard is far
    // smaller than the ±512 range this allows.
    const key = ((ix + 512) << 20) | ((iy + 512) << 10) | (iz + 512);
    if (this.known.has(key)) return;
    this.known.add(key);

    this.cellPosition.set(
      (ix + 0.5) * CELL,
      (iy + 0.5) * CELL,
      (iz + 0.5) * CELL,
    );
    this.matrix.makeTranslation(
      this.cellPosition.x,
      this.cellPosition.y,
      this.cellPosition.z,
    );
    this.mesh.setMatrixAt(this.count, this.matrix);

    this.count += 1;
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
