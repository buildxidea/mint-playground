import * as THREE from "three";

/**
 * The giant rotating plate. All six generations (and their diorama slices)
 * are children of `group`; scroll drives `setEra`, which eases the plate so
 * the active station sits at world origin, directly under the existing
 * camera framing.
 *
 * Geometry contract:
 *  - plate center sits at world (0, 0, -STATION_RADIUS)
 *  - station i is at plate-local yaw i·60°, STATION_RADIUS out from center,
 *    with local yaw i·60° so a centered car faces exactly as before (+Z)
 *  - plateAngle = -eraFloat·60° brings station i to the origin at eraFloat=i
 *  - on screen the plate reads right → center → left (clockwise from above)
 */
export const STATION_RADIUS = 6;
export const PLATE_RADIUS = 9;
export const PLATE_TOP_Y = 0.12;
export const STATION_COUNT = 6;
export const STATION_STEP = Math.PI / 3;

export class Turntable {
  readonly group = new THREE.Group();
  /** extra slow spin used by the finale ring reveal */
  finaleSpin = 0;
  /**
   * Hero intro spin. CarFleet scales this by the intro amount, so it winds
   * back to exactly 0 as the opening shot hands off — the plate always lands
   * square on station 0 rather than drifting off it.
   */
  introSpin = 0;

  constructor() {
    this.group.position.set(0, 0, -STATION_RADIUS);

    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x23262b,
      roughness: 0.55,
      metalness: 0.35,
    });
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(PLATE_RADIUS, PLATE_RADIUS * 0.985, 0.34, 96),
      plateMat,
    );
    plate.position.y = PLATE_TOP_Y - 0.17;
    plate.receiveShadow = true;
    this.group.add(plate);

    // machined rim: a brighter band plus radial tick marks
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x3c4047,
      roughness: 0.35,
      metalness: 0.6,
    });
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(PLATE_RADIUS + 0.06, PLATE_RADIUS + 0.06, 0.1, 96),
      rimMat,
    );
    rim.position.y = PLATE_TOP_Y - 0.05;
    this.group.add(rim);

    const tickGeo = new THREE.BoxGeometry(0.05, 0.02, 0.5);
    const tickMat = new THREE.MeshStandardMaterial({
      color: 0x596069,
      roughness: 0.3,
      metalness: 0.7,
    });
    const ticks = new THREE.InstancedMesh(tickGeo, tickMat, 72);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      m.makeRotationY(a);
      m.setPosition(
        Math.sin(a) * (PLATE_RADIUS - 0.35),
        PLATE_TOP_Y + 0.012,
        Math.cos(a) * (PLATE_RADIUS - 0.35),
      );
      ticks.setMatrixAt(i, m);
    }
    this.group.add(ticks);
  }

  /** plate-local transform for a station index */
  static stationTransform(index: number) {
    const angle = index * STATION_STEP;
    return {
      position: new THREE.Vector3(
        Math.sin(angle) * STATION_RADIUS,
        PLATE_TOP_Y,
        Math.cos(angle) * STATION_RADIUS,
      ),
      yaw: angle,
    };
  }

  setEra(eraFloat: number) {
    this.group.rotation.y =
      -eraFloat * STATION_STEP + this.finaleSpin + this.introSpin;
  }
}
