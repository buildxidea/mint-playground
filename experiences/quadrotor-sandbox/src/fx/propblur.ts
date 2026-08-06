import {
  AdditiveBlending,
  CircleGeometry,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from "three";
import { VEHICLE } from "../sim/config";
import type { DroneState } from "../sim/state";

/**
 * Rotor disc blur.
 *
 * A real propeller past a few thousand rpm reads as a translucent disc, not as
 * blades. Rather than fading the generated propeller meshes — which would mean
 * mutating authored Mint materials — this adds a separate disc per rotor that
 * fades in as the rotor spins up. The propellers keep turning underneath,
 * untouched, and the effect is pure addition that can be removed by deleting
 * these objects.
 */

/** Rotor speed at which the disc is fully opaque, as a fraction of maximum. */
const FULL_BLUR = 0.55;
const PEAK_OPACITY = 0.3;

export class PropBlur {
  readonly discs: Mesh[] = [];
  enabled = true;

  constructor(parent: Object3D, propellerHeight: number, diameter: number) {
    const geometry = new CircleGeometry(diameter / 2, 40);

    for (let i = 0; i < 4; i += 1) {
      const material = new MeshBasicMaterial({
        color: 0xb9c6cf,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      });

      const disc = new Mesh(geometry, material);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(
        VEHICLE.motors[i].x,
        propellerHeight + 0.002,
        VEHICLE.motors[i].z,
      );
      parent.add(disc);
      this.discs.push(disc);
    }
  }

  update(state: DroneState) {
    for (let i = 0; i < this.discs.length; i += 1) {
      const material = this.discs[i].material as MeshBasicMaterial;
      if (!this.enabled) {
        material.opacity = 0;
        continue;
      }
      const fraction = state.motorOmega[i] / VEHICLE.maxRotorOmega;
      const blur = Math.min(1, fraction / FULL_BLUR);
      material.opacity = blur * blur * PEAK_OPACITY;
    }
  }

  dispose() {
    for (const disc of this.discs) {
      disc.geometry.dispose();
      (disc.material as MeshBasicMaterial).dispose();
      disc.removeFromParent();
    }
    this.discs.length = 0;
  }
}
