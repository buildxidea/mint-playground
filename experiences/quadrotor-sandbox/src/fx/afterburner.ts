import {
  AdditiveBlending,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from "three";
import { VEHICLE } from "../sim/config";
import type { DroneState } from "../sim/state";

/**
 * Afterburner exhaust plumes.
 *
 * Built from geometry rather than generated as an asset: the plume has to
 * lengthen, brighten and flicker with the throttle every frame, and a static
 * mesh cannot do any of that. It is also pure addition — nothing here touches
 * the generated airframe's materials.
 *
 * Each nozzle gets three layers, which together read as a real afterburner
 * rather than an orange cone:
 *
 *   - a wide, dim outer plume in deep orange,
 *   - a narrow, bright inner core in pale yellow-white,
 *   - a row of shock diamonds along the axis, the bright pulses that form
 *     where the supersonic exhaust over-expands and re-compresses.
 *
 * The aircraft's nose is -Z, so *aft is +Z* — the plumes must grow toward
 * positive Z. Getting that backwards points the flames out through the nose,
 * which is invisible in a still frame at idle and obvious the moment the
 * throttle comes up. Cones are anchored at the nozzle so they extend aft
 * rather than growing from their centre in both directions.
 */

/** Throttle below which the burner is out entirely. */
const LIGHT_UP = 0.12;

interface Layer {
  mesh: Mesh;
  material: MeshBasicMaterial;
  /** Plume length at full throttle, metres. */
  fullLength: number;
  /** Opacity at full throttle. */
  fullOpacity: number;
}

export interface Afterburners {
  group: Group;
  /** Advance the flicker and follow the throttle. */
  update(state: DroneState, dt: number): void;
  dispose(): void;
}

function makePlume(
  radius: number,
  length: number,
  color: number,
  opacity: number,
): Layer {
  // Unit-length cone, scaled on Z at runtime. Translating by half its height
  // before the rotation puts the tip at the origin, so scaling grows the
  // plume aft from the nozzle instead of through it. The -90 degree rotation
  // sends the body toward +Z (aft); +90 would fire it out through the nose.
  const geometry = new ConeGeometry(radius, 1, 18, 1, true);
  geometry.translate(0, -0.5, 0);
  geometry.rotateX(-Math.PI / 2);

  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  return { mesh: new Mesh(geometry, material), material, fullLength: length, fullOpacity: opacity };
}

/**
 * @param nozzles nozzle positions in body coordinates, metres.
 */
export function createAfterburners(
  parent: Object3D,
  nozzles: Vector3[],
): Afterburners {
  const group = new Group();
  const layers: Layer[] = [];
  const diamonds: { mesh: Mesh; material: MeshBasicMaterial; offset: number }[] = [];

  const diamondGeometry = new SphereGeometry(1, 10, 8);

  for (const nozzle of nozzles) {
    const mount = new Group();
    mount.position.copy(nozzle);

    const outer = makePlume(0.16, 2.6, 0xff6a1e, 0.42);
    const core = makePlume(0.075, 1.5, 0xffe6a8, 0.6);
    mount.add(outer.mesh, core.mesh);
    layers.push(outer, core);

    // Shock diamonds: progressively dimmer and closer together downstream.
    for (let i = 0; i < 4; i += 1) {
      const material = new MeshBasicMaterial({
        color: 0xfff0c4,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const mesh = new Mesh(diamondGeometry, material);
      mesh.scale.set(0.05, 0.05, 0.11);
      mount.add(mesh);
      diamonds.push({ mesh, material, offset: 0.35 + i * 0.42 });
    }

    group.add(mount);
  }

  parent.add(group);

  let time = 0;

  return {
    group,

    update(state, dt) {
      time += dt;

      // Spool speed stands in for throttle: it already lags the stick through
      // the engine model, so the plume inherits that lag for free instead of
      // snapping with the key press.
      const spool = Math.min(1, state.motorOmega[0] / VEHICLE.maxRotorOmega);
      const lit = Math.max(0, (spool - LIGHT_UP) / (1 - LIGHT_UP));

      // Two incommensurate sines: roughly periodic, never visibly repeating,
      // and deterministic, so a recorded flight replays identically.
      const flicker =
        1 + 0.09 * Math.sin(time * 47) + 0.05 * Math.sin(time * 19.3 + 1.7);

      for (const layer of layers) {
        const length = layer.fullLength * lit * flicker;
        layer.mesh.scale.z = Math.max(0.0001, length);
        layer.material.opacity = layer.fullOpacity * lit;
        layer.mesh.visible = lit > 0.001;
      }

      for (const diamond of diamonds) {
        // Diamonds ride aft (+Z) as the plume extends, and fade with distance.
        const along = diamond.offset * lit * flicker;
        diamond.mesh.position.z = along;
        diamond.material.opacity = lit * 0.75 * (1 - diamond.offset / 2.4);
        diamond.mesh.visible = lit > 0.05;
      }
    },

    dispose() {
      for (const layer of layers) {
        layer.mesh.geometry.dispose();
        layer.material.dispose();
      }
      for (const diamond of diamonds) diamond.material.dispose();
      diamondGeometry.dispose();
      group.removeFromParent();
    },
  };
}
