import {
  AdditiveBlending,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";

/**
 * Rocket engine plumes.
 *
 * Kept separate from `fx/afterburner.ts` even though both draw fire out of a
 * nozzle, because they are not the same thing at the scale that matters here:
 * an afterburner is a metre of shock diamonds behind a jet, a launch plume is
 * a third of the vehicle's length.
 *
 * This module also carried a pad smoke cloud — the billowing ground effect at
 * liftoff. It was removed on request rather than left switched off, so nothing
 * here allocates ninety spheres for an effect nobody wants.
 *
 * The flicker is deterministic, driven off `state.time` rather than a random
 * source, so a replayed launch looks identical — the same constraint the wind
 * and the afterburner flicker are held to.
 */

interface PlumeLayer {
  mesh: Mesh;
  material: MeshBasicMaterial;
  baseLength: number;
  baseRadius: number;
}

/** Deterministic two-sine flicker, the same trick the afterburners use. */
function flicker(time: number, phase: number): number {
  return (
    0.88 +
    0.08 * Math.sin(time * 31 + phase) +
    0.04 * Math.sin(time * 71.3 + phase * 2.7)
  );
}

/**
 * A cone pointing aft along +Z, with its apex at the nozzle.
 *
 * The rotation is -90° about X, not +90°. The afterburners shipped with the
 * sign flipped once and fired their plumes forward through the nose, so this
 * is asserted by a test rather than trusted.
 */
function makePlume(radius: number, length: number, colour: number): PlumeLayer {
  const geometry = new ConeGeometry(radius, length, 20, 1, true);
  geometry.translate(0, -length / 2, 0);
  geometry.rotateX(-Math.PI / 2);

  const material = new MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const mesh = new Mesh(geometry, material);
  return { mesh, material, baseLength: length, baseRadius: radius };
}

/**
 * Shortest the flame is ever drawn, metres.
 *
 * Clamping the plume to the room below it would otherwise leave nothing at all
 * to see at the instant of ignition, when the nozzles are sitting on the pad.
 * A short bright flare is both better looking and closer to the truth: a real
 * stack on a pad is throwing its exhaust sideways down a flame trench, not
 * driving a five-metre spike into the concrete.
 */
const MIN_PLUME = 0.9;

export interface EnginePlumes {
  group: Group;
  /** Pilot toggle — the effects can be switched off entirely. */
  enabled: boolean;
  /** Point the plumes at a new set of nozzles — used when a stage is shed. */
  setNozzles(nozzles: Vector3[]): void;
  /**
   * @param level total thrust as a fraction of maximum, 0..1.
   * @param clearance metres of free space beyond the nozzles. The flame is
   *   clamped to it so it cannot be drawn through the ground.
   */
  update(level: number, time: number, clearance?: number): void;
  dispose(): void;
}

/**
 * Plumes at a set of nozzles, sized in metres rather than as a fraction of the
 * vehicle: a rocket's exhaust is a fixed physical thing, and scaling it to the
 * airframe would make the boosters' plumes and the orbiter's the wrong sizes
 * relative to each other.
 */
export function createEnginePlumes(
  parent: Object3D,
  nozzles: Vector3[],
  scale: number,
): EnginePlumes {
  const group = new Group();
  parent.add(group);

  const mounts: Group[] = [];
  const layers: PlumeLayer[] = [];

  const build = (count: number) => {
    for (const mount of mounts) group.remove(mount);
    mounts.length = 0;
    layers.length = 0;

    for (let i = 0; i < count; i += 1) {
      const mount = new Group();
      // Outer plume, then the bright core inside it. Two layers is enough:
      // additive blending does the rest, and the core reads as the hot centre.
      const outer = makePlume(0.34 * scale, 3.1 * scale, 0xff8433);
      const core = makePlume(0.15 * scale, 1.9 * scale, 0xffe9bc);
      mount.add(outer.mesh);
      mount.add(core.mesh);
      layers.push(outer, core);
      mounts.push(mount);
      group.add(mount);
    }
  };

  const place = (positions: Vector3[]) => {
    if (positions.length !== mounts.length) build(positions.length);
    for (let i = 0; i < positions.length; i += 1) mounts[i].position.copy(positions[i]);
  };

  place(nozzles);

  return {
    group,
    enabled: true,

    setNozzles(next) {
      place(next);
    },

    update(level, time, clearance = Infinity) {
      const lit = this.enabled ? Math.max(0, Math.min(1, level)) : 0;
      group.visible = lit > 0.01;
      if (!group.visible) return;

      // How much flame there is room for. On the pad this is zero: the nozzles
      // are *on* the ground, and without the clamp the whole plume is drawn
      // below it. The ground writes depth, so all that survived was a sliver
      // at the tarmac line flickering with the wobble below — which is what
      // ignition looked like, and it looked broken.
      const room = Math.max(MIN_PLUME, clearance);

      for (let i = 0; i < layers.length; i += 1) {
        const layer = layers[i];
        const wobble = flicker(time, i * 1.7);
        // Length responds hard to throttle, radius much less — a throttled
        // engine makes a shorter flame, not a thinner one.
        let stretch = (0.25 + lit * 0.75) * wobble;
        let girth = 0.75 + lit * 0.25;

        if (layer.baseLength * stretch > room) {
          const squashed = room / layer.baseLength;
          // A plume with nowhere to go spreads instead of stopping dead, so it
          // reads as splashing off the pad rather than as a cut-off cone.
          girth *= 1 + Math.min(1, (stretch / squashed - 1) * 0.35);
          stretch = squashed;
        }

        layer.mesh.scale.set(girth, girth, stretch);
        layer.material.opacity =
          (layer.baseRadius > 0.25 * scale ? 0.26 : 0.5) * lit * wobble;
      }
    },

    dispose() {
      for (const layer of layers) {
        layer.mesh.geometry.dispose();
        layer.material.dispose();
      }
      group.removeFromParent();
    },
  };
}
