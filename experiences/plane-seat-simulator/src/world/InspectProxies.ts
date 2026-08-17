import * as THREE from "three";
import {
  type InspectTarget,
  SECTION_TARGETS,
  SPECIFIC_TARGETS,
} from "../data/inspect-targets";

/**
 * Invisible click volumes for everything the overview can frame. Seats already
 * have pick proxies from CabinFurnishings, so these cover the rest: the rooms,
 * the exits, and the section blankets. They are never drawn — the raycaster
 * does not test visibility — so they cost nothing per frame.
 */
export class InspectProxies {
  readonly group = new THREE.Group();
  /** Rooms and exits: resolved before sections, which contain them. */
  readonly specific: THREE.Mesh[] = [];
  /** Cabin thirds: only reached when a click misses everything specific. */
  readonly sections: THREE.Mesh[] = [];

  constructor() {
    const material = new THREE.MeshBasicMaterial();
    const add = (target: InspectTarget, into: THREE.Mesh[]) => {
      const [hx, hy, hz] = target.pick;
      if (hx <= 0 || hy <= 0 || hz <= 0) return;
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
        material,
      );
      proxy.position.set(...(target.pickCenter ?? target.focus));
      proxy.visible = false;
      proxy.userData.targetId = target.id;
      into.push(proxy);
      this.group.add(proxy);
    };

    // Seats are skipped: CabinFurnishings already carries a proxy for each.
    for (const target of SPECIFIC_TARGETS) {
      if (target.kind !== "seat") add(target, this.specific);
    }
    for (const target of SECTION_TARGETS) add(target, this.sections);
  }
}
