import * as THREE from 'three';
import { FLEET, type BoatSpec } from '../game/fleet';
import type { Water } from './Water';
import { disposeObject3D } from '../utils/dispose';
import { loadMintModel } from '../assets/ModelLibrary';
import { seatHullOnWater } from './modelSeating';
import { createHazard, type CircleHazard } from './hazards';
import { Wake } from './Wake';
import type { Gate } from './Course';

interface FloatingProp {
  object: THREE.Object3D;
  x: number;
  z: number;
  spin: number;
  hazard: CircleHazard;
}

interface TrafficBoat {
  group: THREE.Group;
  spec: BoatSpec;
  x: number;
  z: number;
  headingX: number;
  speed: number;
  hazard: CircleHazard;
  wake: Wake;
}

/**
 * The dead stuff in the water: shallows that strand you, debris and pot fields
 * that clutter the channel, and working boats crossing on their own business.
 */
export class SeaHazards {
  readonly group = new THREE.Group();
  readonly hazards: CircleHazard[] = [];

  private readonly props: FloatingProp[] = [];
  private readonly traffic: TrafficBoat[] = [];
  private readonly wakes: Wake[] = [];
  private foamCeiling = 1e9;
  private bounds = { minX: -400, maxX: 400, minZ: 0, maxZ: 1200 };
  private gates: readonly Gate[] = [];
  private layoutToken = 0;

  constructor(private readonly water: Water) {}

  configure(
    spec: BoatSpec,
    startZ: number,
    entranceZ: number,
    random: () => number,
    gates: readonly Gate[] = [],
  ): void {
    this.gates = gates;
    this.layoutToken += 1;
    const token = this.layoutToken;
    this.clear();

    const amplitude = Math.max(spec.length * 2.4, 55);
    this.bounds = {
      minX: -amplitude * 2.4,
      maxX: amplitude * 2.4,
      minZ: entranceZ + spec.length * 0.5,
      maxZ: startZ,
    };
    const span = this.bounds.maxZ - this.bounds.minZ;
    const laneX = () => (random() - 0.5) * amplitude * 2.4;

    this.buildSandbars(spec, span, laneX, random);
    this.buildDebris(spec, span, laneX, random, token);
    this.buildTraffic(spec, span, random, token);
  }

  /**
   * Pick a spot that does not block a gate. A sandbar sitting in the only
   * opening would make a clean run impossible, so static hazards get pushed
   * clear; moving wildlife is free to wander in, which is the point of it.
   */
  private clearOfGates(
    x: number,
    z: number,
    radius: number,
    laneX: () => number,
    random: () => number,
  ): { x: number; z: number } {
    let candidateX = x;
    let candidateZ = z;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const blocked = this.gates.some((gate) => {
        const nearZ = Math.abs(candidateZ - gate.z) < radius + gate.halfWidth * 0.35;
        const insideX = Math.abs(candidateX - gate.x) < gate.halfWidth + radius;
        return nearZ && insideX;
      });
      if (!blocked) break;
      candidateX = laneX();
      candidateZ += (random() - 0.5) * radius * 4;
    }
    return { x: candidateX, z: candidateZ };
  }

  update(delta: number, time: number, water: Water): void {
    for (const prop of this.props) {
      prop.object.position.y = water.heightAt(prop.x, prop.z, time);
      prop.object.rotation.y += prop.spin * delta;
      prop.object.rotation.z = Math.sin(time * 0.8 + prop.x) * 0.06;
    }

    for (const boat of this.traffic) {
      boat.x += boat.headingX * boat.speed * delta;
      if (boat.x < this.bounds.minX || boat.x > this.bounds.maxX) {
        boat.headingX *= -1;
        boat.x = THREE.MathUtils.clamp(boat.x, this.bounds.minX, this.bounds.maxX);
        // Turning on the spot would fold the ribbon back through itself.
        boat.wake.reset();
      }
      const surface = water.heightAt(boat.x, boat.z, time);
      const response = THREE.MathUtils.clamp(9 / boat.spec.length, 0.08, 1) * 0.8;
      boat.group.position.set(boat.x, surface * response, boat.z);
      boat.group.rotation.y = boat.headingX > 0 ? Math.PI / 2 : -Math.PI / 2;
      boat.group.rotation.z = Math.sin(time * 0.7 + boat.z) * 0.03 * response;
      boat.hazard.x = boat.x;
      boat.hazard.z = boat.z;

      const heading = boat.headingX > 0 ? Math.PI / 2 : -Math.PI / 2;
      const stern = boat.spec.length * 0.38 * boat.headingX;
      boat.wake.update(delta, time, boat.x - stern, boat.z, heading, delta > 0 ? boat.speed : 0);
    }
  }

  /** Cap traffic foam under the dock deck, same as the player's. */
  setFoamCeiling(height: number): void {
    this.foamCeiling = height;
    for (const wake of this.wakes) wake.setCeiling(height);
  }

  dispose(): void {
    for (const wake of this.wakes) wake.dispose();
    this.wakes.length = 0;
    disposeObject3D(this.group);
  }

  // -------------------------------------------------------------- sandbars

  private buildSandbars(
    spec: BoatSpec,
    span: number,
    laneX: () => number,
    random: () => number,
  ): void {
    const material = new THREE.MeshStandardMaterial({
      color: '#b8a276',
      roughness: 0.95,
      metalness: 0,
    });
    const count = 4;
    for (let i = 0; i < count; i += 1) {
      const radius = Math.max(spec.length * 0.55, 14) * (0.7 + random() * 0.6);
      const rawZ = this.bounds.minZ + span * ((i + 0.5) / count) + (random() - 0.5) * span * 0.1;
      const { x, z } = this.clearOfGates(laneX(), rawZ, radius, laneX, random);

      // A shallow dome, not a flat disc: seen from a low chase camera a disc
      // reads as a sheet of cardboard on the water, while a bank barely
      // breaking the surface reads as ground.
      const bank = new THREE.Mesh(new THREE.SphereGeometry(radius, 26, 14), material);
      bank.scale.set(1, 0.05, 0.65 + random() * 0.45);
      bank.position.set(x, -radius * 0.028, z);
      bank.rotation.y = random() * Math.PI;
      bank.receiveShadow = true;
      bank.castShadow = true;
      this.group.add(bank);

      this.hazards.push(
        createHazard('sandbar', x, z, radius, {
          // No damage: running aground costs you speed and time, not the hull.
          // Strong enough to be a real setback, weak enough to power out of.
          drag: 1.15,
          label: 'Shallows',
        }),
      );
    }
  }

  // ---------------------------------------------------------------- debris

  private buildDebris(
    spec: BoatSpec,
    span: number,
    laneX: () => number,
    random: () => number,
    token: number,
  ): void {
    const scale = THREE.MathUtils.clamp(spec.length / 14, 0.7, 3.2);
    const plan: { key: string; count: number; size: number; damage: number }[] = [
      { key: 'debris-log', count: 6, size: 5 * scale, damage: 5 },
      { key: 'debris-pot', count: 8, size: 1.6 * scale, damage: 4 },
    ];

    for (const entry of plan) {
      for (let i = 0; i < entry.count; i += 1) {
        const { x, z } = this.clearOfGates(
          laneX(),
          this.bounds.minZ + span * random(),
          entry.size,
          laneX,
          random,
        );
        const placeholder = new THREE.Mesh(
          new THREE.CylinderGeometry(entry.size * 0.16, entry.size * 0.16, entry.size, 7),
          new THREE.MeshStandardMaterial({ color: '#6b5a44', roughness: 0.95, metalness: 0 }),
        );
        placeholder.rotation.z = Math.PI / 2;
        placeholder.castShadow = true;

        const holder = new THREE.Group();
        holder.position.set(x, 0, z);
        holder.rotation.y = random() * Math.PI * 2;
        holder.add(placeholder);
        this.group.add(holder);

        const hazard = createHazard('debris', x, z, entry.size * 0.7, {
          damage: entry.damage,
          drag: 0.8,
          label: entry.key === 'debris-log' ? 'Driftwood' : 'Pot buoy',
        });
        this.hazards.push(hazard);
        this.props.push({ object: holder, x, z, spin: (random() - 0.5) * 0.25, hazard });

        loadMintModel(entry.key)
          .then((model) => {
            if (token !== this.layoutToken) {
              disposeObject3D(model);
              return;
            }
            const bounds = new THREE.Box3().setFromObject(model);
            const size = bounds.getSize(new THREE.Vector3());
            const factor = entry.size / Math.max(size.x, size.z, 0.001);
            model.scale.multiplyScalar(factor);
            bounds.setFromObject(model);
            const center = bounds.getCenter(new THREE.Vector3());
            model.position.set(-center.x, -bounds.min.y - entry.size * 0.12, -center.z);
            model.traverse((child) => {
              if (child instanceof THREE.Mesh) child.castShadow = true;
            });
            holder.remove(placeholder);
            disposeObject3D(placeholder);
            holder.add(model);
          })
          .catch(() => {
            // Placeholder debris stays.
          });
      }
    }
  }

  // --------------------------------------------------------------- traffic

  private buildTraffic(
    spec: BoatSpec,
    span: number,
    random: () => number,
    token: number,
  ): void {
    // Working boats roughly in scale with the player, drawn from the fleet.
    const candidates = FLEET.filter(
      (other) => other.length >= spec.length * 0.25 && other.length <= spec.length * 1.6,
    );
    const pool = candidates.length ? candidates : [FLEET[3]];
    const count = 3;

    for (let i = 0; i < count; i += 1) {
      const traffic = pool[Math.floor(random() * pool.length) % pool.length];
      const z = this.bounds.minZ + span * ((i + 0.75) / count);
      const headingX = random() < 0.5 ? 1 : -1;
      const x = headingX > 0 ? this.bounds.minX : this.bounds.maxX;

      const group = new THREE.Group();
      group.position.set(x, 0, z);
      this.group.add(group);

      const hazard = createHazard('traffic', x, z, Math.max(traffic.length, traffic.beam) * 0.45, {
        damage: 26,
        drag: 1.2,
        solid: true,
        label: traffic.name,
      });
      this.hazards.push(hazard);

      // Working boats leave the same wake the player does, scaled to their own
      // beam — a hull under way without one reads as sliding on glass.
      const wake = new Wake(this.water);
      wake.configure(traffic.beam);
      wake.setCeiling(this.foamCeiling);
      this.group.add(wake.mesh);
      this.wakes.push(wake);

      this.traffic.push({
        group,
        spec: traffic,
        x,
        z,
        headingX,
        speed: 2.5 + random() * 3.5,
        hazard,
        wake,
      });

      loadMintModel(traffic.mintKey)
        .then((model) => {
          if (token !== this.layoutToken) {
            disposeObject3D(model);
            return;
          }
          seatHullOnWater(model, traffic);
          group.add(model);
        })
        .catch(() => {
          // Traffic stays invisible but still blocks; better than crashing.
        });
    }
  }

  private clear(): void {
    // Wakes first: each one is registered with the ocean, and a stale one would
    // go on being sampled by every height query for the rest of the run.
    for (const wake of this.wakes) wake.dispose();
    this.wakes.length = 0;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeObject3D(child);
    }
    this.props.length = 0;
    this.traffic.length = 0;
    this.hazards.length = 0;
  }
}
