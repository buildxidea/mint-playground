import * as THREE from 'three';
import { CORRIDOR, SPAWN } from '../config';
import { BubbleRing } from '../entities/BubbleRing';
import { Jellyfish } from '../entities/Jellyfish';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { fitModel } from '../assets/AssetLibrary';

type Chunk = {
  index: number;
  rings: BubbleRing[];
  jellies: Jellyfish[];
  scenery: THREE.Object3D[];
};

const PROP_KEYS = ['prop-branching-coral', 'prop-boulder-coral', 'prop-sea-anemone', 'prop-kelp-strand'];

/** Backdrop jellyfish tints — pinks, purples, teals, ambers. */
const JELLY_TINTS = [
  new THREE.Color('#ff6fb0'),
  new THREE.Color('#c76bff'),
  new THREE.Color('#7f7bff'),
  new THREE.Color('#4fd8c9'),
  new THREE.Color('#63c4ff'),
  new THREE.Color('#ffb45c'),
  new THREE.Color('#ff8b8b'),
];

/**
 * Endless chunked spawner. Chunks are laid out along -Z ahead of the fish;
 * each places a loose racing line of bubble rings, interactive jellyfish near
 * that line, dim background jellyfish, and seabed props. Difficulty (density,
 * ring offset) ramps with distance.
 */
export class Spawner {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<number, Chunk>();
  private lineX = 0;
  private lineY = 10;

  constructor(
    private readonly assets: AssetLibrary,
    private rng: () => number,
  ) {}

  get activeRings(): BubbleRing[] {
    const rings: BubbleRing[] = [];
    for (const chunk of this.chunks.values()) rings.push(...chunk.rings);
    return rings;
  }

  get activeJellies(): Jellyfish[] {
    const jellies: Jellyfish[] = [];
    for (const chunk of this.chunks.values()) jellies.push(...chunk.jellies);
    return jellies;
  }

  update(delta: number, elapsed: number, playerZ: number): void {
    const currentChunk = Math.floor(-playerZ / SPAWN.chunkLength);
    for (let i = currentChunk; i <= currentChunk + SPAWN.chunksAhead; i += 1) {
      if (i >= 0 && !this.chunks.has(i)) this.spawnChunk(i);
    }
    for (const [index, chunk] of this.chunks) {
      // Despawn only once the chunk's FAR edge is well behind the player, so
      // every object visibly passes the camera before it is removed.
      const chunkFarZ = -(index + 1) * SPAWN.chunkLength;
      if (chunkFarZ > playerZ + SPAWN.despawnBehind) {
        this.despawnChunk(chunk);
        this.chunks.delete(index);
      }
    }

    for (const chunk of this.chunks.values()) {
      for (const ring of chunk.rings) ring.update(delta);
      for (const jelly of chunk.jellies) jelly.update(delta, elapsed);
    }
  }

  reset(seededRng: () => number): void {
    this.rng = seededRng;
    for (const chunk of this.chunks.values()) this.despawnChunk(chunk);
    this.chunks.clear();
    this.lineX = 0;
    this.lineY = 10;
  }

  private spawnChunk(index: number): void {
    const zStart = -index * SPAWN.chunkLength;
    const difficulty = Math.min(1, index / 22);
    const chunk: Chunk = { index, rings: [], jellies: [], scenery: [] };

    // Racing line of rings: a smooth wander the rings loosely follow.
    const ringCount = Math.round(
      THREE.MathUtils.lerp(SPAWN.ringsPerChunkMin, SPAWN.ringsPerChunkMax, difficulty * this.rng()),
    );
    const wander = 3.5 + difficulty * 5.5;
    for (let i = 0; i < ringCount; i += 1) {
      const z = zStart - ((i + 0.5) / ringCount) * SPAWN.chunkLength;
      this.lineX = THREE.MathUtils.clamp(
        this.lineX + (this.rng() - 0.5) * wander * 2,
        -CORRIDOR.halfWidth + 4,
        CORRIDOR.halfWidth - 4,
      );
      this.lineY = THREE.MathUtils.clamp(this.lineY + (this.rng() - 0.5) * wander, 4, CORRIDOR.maxY - 5);
      const ring = new BubbleRing(this.assets.instance('bubble-ring'));
      ring.place(this.lineX, this.lineY, z, (this.rng() - 0.5) * 1.4);
      chunk.rings.push(ring);
      this.group.add(ring.group);
    }

    // Interactive jellyfish: some parked near the ring line as bounce
    // opportunities, some drifting as tentacle hazards between rings.
    const jellyCount = Math.round(
      THREE.MathUtils.lerp(SPAWN.jelliesPerChunkMin, SPAWN.jelliesPerChunkMax, difficulty),
    );
    for (let i = 0; i < jellyCount; i += 1) {
      const nearLine = this.rng() < 0.45 && chunk.rings.length > 0;
      const z = zStart - this.rng() * SPAWN.chunkLength;
      let x: number;
      let y: number;
      if (nearLine) {
        const ring = chunk.rings[Math.floor(this.rng() * chunk.rings.length)];
        x = ring.group.position.x + (this.rng() - 0.5) * 8;
        y = Math.max(5, ring.group.position.y - 4 - this.rng() * 3);
      } else {
        x = (this.rng() - 0.5) * 2 * (CORRIDOR.halfWidth - 2);
        y = 5 + this.rng() * (CORRIDOR.maxY - 10);
      }
      const jelly = new Jellyfish(this.assets.instance('jellyfish'));
      jelly.place(x, y, z, this.rng() * Math.PI * 2, 0.7 + this.rng() * 0.7);
      chunk.jellies.push(jelly);
      this.group.add(jelly.group);
    }

    // Background jellyfish: tinted, non-interactive swarm filling the
    // periphery — beside the corridor, far ahead, and high above.
    const backgroundCount = Math.round(SPAWN.backgroundJellies / SPAWN.chunksAhead);
    for (let i = 0; i < backgroundCount; i += 1) {
      const tint = JELLY_TINTS[Math.floor(this.rng() * JELLY_TINTS.length)];
      const jelly = new Jellyfish(this.assets.instance('jellyfish'), true, tint);
      const lane = this.rng();
      let x: number;
      let y: number;
      if (lane < 0.62) {
        // Flanks of the corridor.
        const side = this.rng() < 0.5 ? -1 : 1;
        x = side * (CORRIDOR.halfWidth + 5 + this.rng() * 34);
        y = 3 + this.rng() * 30;
      } else if (lane < 0.85) {
        // High above the play space, drifting silhouettes.
        x = (this.rng() - 0.5) * 70;
        y = CORRIDOR.maxY + 4 + this.rng() * 14;
      } else {
        // Deep in the fog straight ahead for depth.
        x = (this.rng() - 0.5) * 50;
        y = 4 + this.rng() * 26;
      }
      jelly.place(
        x,
        y,
        zStart - this.rng() * SPAWN.chunkLength,
        this.rng() * Math.PI * 2,
        0.5 + this.rng() * 0.5,
      );
      jelly.group.scale.setScalar(0.55 + this.rng() * 1.25);
      jelly.interactive = false;
      chunk.jellies.push(jelly);
      this.group.add(jelly.group);
    }

    // Seabed props.
    for (let i = 0; i < SPAWN.propsPerChunk; i += 1) {
      const key = PROP_KEYS[Math.floor(this.rng() * PROP_KEYS.length)];
      const asset = this.assets.instance(key);
      if (!asset) continue;
      const prop = fitModel(asset.scene, 2.6 + this.rng() * 3.6);
      const box = new THREE.Box3().setFromObject(prop);
      prop.position.set(
        (this.rng() - 0.5) * 2 * (CORRIDOR.halfWidth + 30),
        CORRIDOR.seabedY - box.min.y,
        zStart - this.rng() * SPAWN.chunkLength,
      );
      prop.rotation.y = this.rng() * Math.PI * 2;
      chunk.scenery.push(prop);
      this.group.add(prop);
    }

    this.chunks.set(index, chunk);
  }

  private despawnChunk(chunk: Chunk): void {
    // Visuals are clones sharing geometry/materials with the AssetLibrary
    // templates (or module-level blockout resources), so removal is enough.
    for (const ring of chunk.rings) this.group.remove(ring.group);
    for (const jelly of chunk.jellies) this.group.remove(jelly.group);
    for (const prop of chunk.scenery) this.group.remove(prop);
  }
}
