import * as THREE from 'three';
import type { BoatSpec } from '../game/fleet';
import type { Water } from './Water';
import type { Course } from './Course';
import { disposeObject3D } from '../utils/dispose';
import { loadMintModel } from '../assets/ModelLibrary';
import { applySwimFlex, prepareCreature, type SwimUniforms } from './swimShader';
import { createHazard, type CircleHazard } from './hazards';

/** Base sizes in meters before the readability scale is applied. */
const WHALE_LENGTH = 16;
const DOLPHIN_LENGTH = 2.6;
const FISH_LENGTH = 0.55;

type DolphinBehaviour = 'fin' | 'leap' | 'porpoise' | 'cross';

interface Creature {
  group: THREE.Group;
  swim: SwimUniforms | null;
  hazard: CircleHazard;
}

interface Dolphin extends Creature {
  behaviour: DolphinBehaviour;
  x: number;
  z: number;
  headingX: number;
  headingZ: number;
  speed: number;
  phase: number;
  length: number;
}

interface Shoal {
  group: THREE.Group;
  members: { mesh: THREE.Object3D; offsetX: number; offsetZ: number; swim: SwimUniforms | null }[];
  x: number;
  z: number;
  headingX: number;
  headingZ: number;
  speed: number;
  hazard: CircleHazard;
}

type WhalePhase = 'cruise' | 'spout' | 'dive' | 'under' | 'rise';

const WHALE_CYCLE: { phase: WhalePhase; duration: number }[] = [
  { phase: 'cruise', duration: 9 },
  { phase: 'spout', duration: 2 },
  { phase: 'dive', duration: 3.5 },
  { phase: 'under', duration: 7 },
  { phase: 'rise', duration: 2.5 },
];

/**
 * Everything alive on the approach.
 *
 * The whale runs a surfaced-cruise / spout / dive / resurface cycle and stays a
 * solid hazard the whole way through, including while submerged — a ring on the
 * water marks where it is so a collision is a misjudgement, not an ambush.
 * Dolphins are deliberately sparse and mixed: some only show a dorsal fin, some
 * leap clear, some porpoise in arcs, some cross the channel in front of you.
 * Fish stay below the surface, drawn as dark gliding silhouettes.
 */
export class Wildlife {
  readonly group = new THREE.Group();
  readonly hazards: CircleHazard[] = [];

  private whale: Creature | null = null;
  private whaleX = 0;
  private whaleZ = 0;
  private whaleHeading = 0;
  private whaleSpeed = 2.2;
  private whaleLength = WHALE_LENGTH;
  private whaleCycleTime = 0;
  private currentWhalePhase: WhalePhase = 'cruise';
  private whaleRing: THREE.Mesh | null = null;
  private spout: THREE.Mesh | null = null;

  private readonly dolphins: Dolphin[] = [];
  private readonly shoals: Shoal[] = [];
  private bounds = { minX: -400, maxX: 400, minZ: 0, maxZ: 1200 };
  private layoutToken = 0;

  /** Build the population for one run. */
  configure(spec: BoatSpec, course: Course, entranceZ: number, random: () => number): void {
    this.layoutToken += 1;
    const token = this.layoutToken;
    this.clear();

    // Real animals are fixed-size, but a 16 m whale is invisible from a
    // carrier's camera, so scale them up a little for readability.
    const scale = THREE.MathUtils.clamp(spec.length / 18, 0.8, 3);
    this.whaleLength = WHALE_LENGTH * scale;
    const dolphinLength = DOLPHIN_LENGTH * scale;
    const fishLength = FISH_LENGTH * scale;

    const amplitude = Math.max(spec.length * 2.4, 55);
    this.bounds = {
      minX: -amplitude * 2.2,
      maxX: amplitude * 2.2,
      minZ: entranceZ + spec.length,
      maxZ: course.startZ,
    };
    const span = this.bounds.maxZ - this.bounds.minZ;
    const laneX = () => (random() - 0.5) * amplitude * 2.6;

    // --- Whale: crossing the middle of the course, so it drifts into your line.
    this.whaleZ = this.bounds.minZ + span * (0.42 + random() * 0.2);
    this.whaleX = laneX();
    this.whaleHeading = random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    this.whaleSpeed = 1.6 + random() * 1.2;
    this.whaleCycleTime = random() * 12;
    this.whale = this.spawnCreature('sea-whale', this.whaleLength, token, {
      amplitude: this.whaleLength * 0.035,
      frequency: 0.22 / scale,
      speed: 1.5,
      hazard: createHazard('whale', this.whaleX, this.whaleZ, this.whaleLength * 0.42, {
        damage: 34,
        drag: 1.4,
        solid: true,
        label: 'Whale',
      }),
      fallback: () => this.blockoutBody(this.whaleLength, '#3d4a55'),
    });

    this.whaleRing = new THREE.Mesh(
      new THREE.RingGeometry(this.whaleLength * 0.42, this.whaleLength * 0.52, 48),
      new THREE.MeshBasicMaterial({ color: '#e8a83b', transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.whaleRing.geometry.rotateX(-Math.PI / 2);
    this.group.add(this.whaleRing);

    this.spout = new THREE.Mesh(
      new THREE.ConeGeometry(this.whaleLength * 0.05, this.whaleLength * 0.55, 10, 1, true),
      new THREE.MeshStandardMaterial({
        color: '#eef4f6',
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      }),
    );
    this.spout.visible = false;
    this.group.add(this.spout);

    // --- Dolphins: a few only, one of each behaviour plus a spare.
    const behaviours: DolphinBehaviour[] = ['fin', 'leap', 'porpoise', 'porpoise', 'cross'];
    behaviours.forEach((behaviour, i) => {
      const z = this.bounds.minZ + span * ((i + 0.6) / behaviours.length);
      const crossing = behaviour === 'cross';
      const dolphin: Dolphin = {
        ...this.spawnCreature('sea-dolphin', dolphinLength, token, {
          amplitude: dolphinLength * 0.06,
          frequency: 1.1 / scale,
          speed: 5.5,
          phase: random() * Math.PI * 2,
          hazard: createHazard('dolphin', 0, 0, dolphinLength * 0.8, {
            damage: 9,
            drag: 0.6,
            label: 'Dolphin',
          }),
          fallback: () => this.blockoutBody(dolphinLength, '#6d7780'),
        }),
        behaviour,
        x: crossing ? this.bounds.minX : laneX(),
        z,
        headingX: crossing ? 1 : 0,
        headingZ: crossing ? 0 : random() < 0.5 ? 1 : -1,
        speed: crossing ? 6 + random() * 3 : 3 + random() * 3,
        phase: random() * Math.PI * 2,
        length: dolphinLength,
      };
      this.dolphins.push(dolphin);
    });

    // --- Fish: shoals of dark silhouettes drifting below the surface.
    const shoalCount = 4;
    for (let i = 0; i < shoalCount; i += 1) {
      const shoal: Shoal = {
        group: new THREE.Group(),
        members: [],
        x: laneX(),
        z: this.bounds.minZ + span * ((i + 0.35) / shoalCount),
        headingX: random() - 0.5,
        headingZ: random() - 0.5,
        speed: 1.2 + random() * 1.4,
        hazard: createHazard('fish', 0, 0, fishLength * 9, {
          damage: 3,
          drag: 0.25,
          label: 'Fish',
        }),
      };
      this.group.add(shoal.group);
      this.shoals.push(shoal);
      this.hazards.push(shoal.hazard);
      this.populateShoal(shoal, fishLength, token, random);
    }
  }

  /** Live creature state, for QA framing and animation checks. */
  snapshot(): {
    whale: { x: number; y: number; z: number; phase: string; visible: boolean } | null;
    dolphins: {
      x: number;
      y: number;
      z: number;
      behaviour: string;
      visible: boolean;
      size: { x: number; y: number; z: number };
    }[];
  } {
    return {
      whale: this.whale
        ? {
            x: this.whaleX,
            y: this.whale.group.position.y,
            z: this.whaleZ,
            phase: this.currentWhalePhase,
            visible: this.whale.group.visible,
          }
        : null,
      dolphins: this.dolphins.map((d) => {
        const size = new THREE.Box3().setFromObject(d.group).getSize(new THREE.Vector3());
        return {
          x: d.x,
          y: d.group.position.y,
          z: d.z,
          behaviour: d.behaviour,
          visible: d.group.visible,
          size: { x: size.x, y: size.y, z: size.z },
        };
      }),
    };
  }

  update(delta: number, time: number, water: Water): void {
    this.updateWhale(delta, time, water);
    this.updateDolphins(delta, time, water);
    this.updateShoals(delta, time, water);
  }

  dispose(): void {
    disposeObject3D(this.group);
  }

  // ------------------------------------------------------------------ whale

  private updateWhale(delta: number, time: number, water: Water): void {
    if (!this.whale) return;
    this.whaleCycleTime += delta;

    const total = WHALE_CYCLE.reduce((sum, step) => sum + step.duration, 0);
    let t = this.whaleCycleTime % total;
    let phase: WhalePhase = 'cruise';
    let progress = 0;
    for (const step of WHALE_CYCLE) {
      if (t < step.duration) {
        phase = step.phase;
        progress = t / step.duration;
        break;
      }
      t -= step.duration;
    }

    // It keeps swimming the whole cycle, which is why it surfaces somewhere new.
    const speed = phase === 'under' ? this.whaleSpeed * 1.35 : this.whaleSpeed;
    this.whaleX += Math.sin(this.whaleHeading) * speed * delta;
    this.whaleZ += Math.cos(this.whaleHeading) * speed * delta;
    if (this.whaleX < this.bounds.minX || this.whaleX > this.bounds.maxX) {
      this.whaleHeading += Math.PI;
      this.whaleX = THREE.MathUtils.clamp(this.whaleX, this.bounds.minX, this.bounds.maxX);
    }

    const depth = this.whaleLength * 0.75;
    let y = 0;
    let pitch = 0;
    switch (phase) {
      case 'cruise':
      case 'spout':
        y = 0;
        break;
      case 'dive':
        // Arch over and slide under, tail coming up as the nose goes down.
        y = -depth * this.easeIn(progress);
        pitch = Math.sin(progress * Math.PI) * 0.85;
        break;
      case 'under':
        y = -depth;
        break;
      case 'rise':
        y = -depth * (1 - this.easeIn(progress));
        pitch = -Math.sin(progress * Math.PI) * 0.5;
        break;
    }

    this.currentWhalePhase = phase;
    const surface = water.heightAt(this.whaleX, this.whaleZ, time);
    const submerged = y < -this.whaleLength * 0.08;
    this.whale.group.position.set(this.whaleX, surface + y - this.whaleLength * 0.06, this.whaleZ);
    this.whale.group.rotation.set(pitch, this.whaleHeading, Math.sin(time * 0.5) * 0.05);
    this.whale.group.visible = y > -depth * 0.92;
    if (this.whale.swim) this.whale.swim.uTime.value = time;

    this.whale.hazard.x = this.whaleX;
    this.whale.hazard.z = this.whaleZ;

    // The ring is the promise that the hazard is always readable.
    if (this.whaleRing) {
      this.whaleRing.position.set(this.whaleX, surface + 0.25, this.whaleZ);
      const material = this.whaleRing.material as THREE.MeshBasicMaterial;
      material.color.set(submerged ? '#c2402f' : '#e8a83b');
      material.opacity = submerged ? 0.72 : 0.4;
      const pulse = submerged ? 1 + Math.sin(time * 2.4) * 0.05 : 1;
      this.whaleRing.scale.setScalar(pulse);
    }

    if (this.spout) {
      const blowing = phase === 'spout';
      this.spout.visible = blowing;
      if (blowing) {
        const rise = Math.sin(progress * Math.PI);
        this.spout.position.set(
          this.whaleX + Math.sin(this.whaleHeading) * this.whaleLength * 0.3,
          surface + this.whaleLength * 0.28 * rise,
          this.whaleZ + Math.cos(this.whaleHeading) * this.whaleLength * 0.3,
        );
        this.spout.scale.set(1, Math.max(0.15, rise), 1);
      }
    }
  }

  // --------------------------------------------------------------- dolphins

  private updateDolphins(delta: number, time: number, water: Water): void {
    for (const dolphin of this.dolphins) {
      dolphin.x += dolphin.headingX * dolphin.speed * delta;
      dolphin.z += dolphin.headingZ * dolphin.speed * delta;

      if (dolphin.x < this.bounds.minX || dolphin.x > this.bounds.maxX) {
        dolphin.headingX *= -1;
        dolphin.x = THREE.MathUtils.clamp(dolphin.x, this.bounds.minX, this.bounds.maxX);
      }
      if (dolphin.z < this.bounds.minZ || dolphin.z > this.bounds.maxZ) {
        dolphin.headingZ *= -1;
        dolphin.z = THREE.MathUtils.clamp(dolphin.z, this.bounds.minZ, this.bounds.maxZ);
      }

      const surface = water.heightAt(dolphin.x, dolphin.z, time);
      const len = dolphin.length;
      let y = 0;
      let pitch = 0;

      switch (dolphin.behaviour) {
        case 'fin': {
          // Body under, dorsal fin slicing the surface.
          y = -len * 0.28 + Math.sin(time * 1.4 + dolphin.phase) * len * 0.04;
          pitch = 0;
          break;
        }
        case 'leap': {
          // Long glide under, then a hard jump clear of the water.
          const cycle = 6;
          const p = ((time * 1 + dolphin.phase) % cycle) / cycle;
          if (p < 0.32) {
            const jump = p / 0.32;
            const arc = Math.sin(jump * Math.PI);
            y = -len * 0.2 + arc * len * 1.5;
            pitch = -Math.cos(jump * Math.PI) * 0.9;
          } else {
            y = -len * 0.45;
            pitch = 0;
          }
          break;
        }
        case 'porpoise':
        case 'cross': {
          // Continuous shallow arcs in and out of the water.
          const w = time * 2.1 + dolphin.phase;
          y = Math.sin(w) * len * 0.5 - len * 0.1;
          pitch = -Math.cos(w) * 0.5;
          break;
        }
      }

      const heading = Math.atan2(dolphin.headingX, dolphin.headingZ);
      dolphin.group.position.set(dolphin.x, surface + y, dolphin.z);
      dolphin.group.rotation.set(pitch, heading, 0);
      dolphin.group.visible = y > -len * 0.6;
      if (dolphin.swim) dolphin.swim.uTime.value = time;
      dolphin.hazard.x = dolphin.x;
      dolphin.hazard.z = dolphin.z;
    }
  }

  // ------------------------------------------------------------------- fish

  private updateShoals(delta: number, time: number, water: Water): void {
    for (const shoal of this.shoals) {
      shoal.x += shoal.headingX * shoal.speed * delta;
      shoal.z += shoal.headingZ * shoal.speed * delta;
      if (shoal.x < this.bounds.minX || shoal.x > this.bounds.maxX) shoal.headingX *= -1;
      if (shoal.z < this.bounds.minZ || shoal.z > this.bounds.maxZ) shoal.headingZ *= -1;

      const heading = Math.atan2(shoal.headingX, shoal.headingZ);
      shoal.group.rotation.y = heading;
      shoal.hazard.x = shoal.x;
      shoal.hazard.z = shoal.z;

      for (const member of shoal.members) {
        const x = shoal.x + member.offsetX;
        const z = shoal.z + member.offsetZ;
        // Silhouettes ride just over the wave surface: the water is opaque, so a
        // truly submerged fish would be invisible. Flattened and darkened, this
        // reads as a shape gliding underneath.
        member.mesh.position.set(
          member.offsetX,
          water.heightAt(x, z, time) + 0.06 - shoal.group.position.y,
          member.offsetZ,
        );
        if (member.swim) member.swim.uTime.value = time;
      }
      shoal.group.position.set(shoal.x, 0, shoal.z);
    }
  }

  // ----------------------------------------------------------------- shared

  private populateShoal(
    shoal: Shoal,
    fishLength: number,
    token: number,
    random: () => number,
  ): void {
    const count = 7;
    const spread = fishLength * 7;
    for (let i = 0; i < count; i += 1) {
      const member = {
        mesh: this.blockoutBody(fishLength, '#16323f'),
        offsetX: (random() - 0.5) * spread,
        offsetZ: (random() - 0.5) * spread * 1.6,
        swim: null as SwimUniforms | null,
      };
      member.mesh.scale.y = 0.2;
      shoal.group.add(member.mesh);
      shoal.members.push(member);
    }

    loadMintModel('sea-fish')
      .then((model) => {
        if (token !== this.layoutToken) {
          disposeObject3D(model);
          return;
        }
        shoal.members.forEach((member, index) => {
          const fish = index === 0 ? model : model.clone(true);
          prepareCreature(fish, fishLength);
          this.darken(fish, '#12293a');
          const swim = applySwimFlex(fish, {
            amplitude: fishLength * 0.1,
            frequency: 5,
            speed: 9,
            bodyHalf: fishLength / 2,
            phase: index * 0.7,
          });
          // Squashed flat so it reads as a shadow rather than a floating fish.
          fish.scale.y *= 0.22;
          shoal.group.remove(member.mesh);
          disposeObject3D(member.mesh);
          member.mesh = fish;
          member.swim = swim;
          shoal.group.add(fish);
        });
      })
      .catch(() => {
        // Blockout silhouettes stay.
      });
  }

  private spawnCreature(
    key: string,
    length: number,
    token: number,
    options: {
      amplitude: number;
      frequency: number;
      speed: number;
      phase?: number;
      hazard: CircleHazard;
      fallback: () => THREE.Object3D;
    },
  ): Creature {
    const group = new THREE.Group();
    const placeholder = options.fallback();
    group.add(placeholder);
    this.group.add(group);
    this.hazards.push(options.hazard);

    const creature: Creature = { group, swim: null, hazard: options.hazard };

    loadMintModel(key)
      .then((model) => {
        if (token !== this.layoutToken) {
          disposeObject3D(model);
          return;
        }
        const { bodyHalf } = prepareCreature(model, length);
        creature.swim = applySwimFlex(model, {
          amplitude: options.amplitude,
          frequency: options.frequency,
          speed: options.speed,
          bodyHalf,
          phase: options.phase,
        });
        group.remove(placeholder);
        disposeObject3D(placeholder);
        group.add(model);
      })
      .catch(() => {
        // The blockout body stays; the hazard still works.
      });

    return creature;
  }

  /** Simple tapered body used until the generated model arrives. */
  private blockoutBody(length: number, color: string): THREE.Object3D {
    const geometry = new THREE.CapsuleGeometry(length * 0.13, length * 0.6, 4, 8);
    geometry.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 }),
    );
    mesh.castShadow = true;
    return mesh;
  }

  private darken(root: THREE.Object3D, color: string): void {
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        if (standard.color) standard.color.set(color);
        if ('map' in standard) standard.map = null;
        standard.roughness = 1;
        standard.metalness = 0;
      }
    });
  }

  private easeIn(t: number): number {
    return t * t;
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeObject3D(child);
    }
    this.dolphins.length = 0;
    this.shoals.length = 0;
    this.hazards.length = 0;
    this.whale = null;
    this.whaleRing = null;
    this.spout = null;
  }
}
