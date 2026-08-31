import * as THREE from 'three';
import { FLEET, approachDistance, type BoatSpec } from '../game/fleet';
import type { Water } from './Water';
import { disposeObject3D } from '../utils/dispose';
import { seatHullOnWater } from './modelSeating';
import { loadMintModel } from '../assets/ModelLibrary';
import { createSeededRandom } from '../utils/random';

const DOCK_FACE_Z = 0; // The main quay occupies z < 0; playable water is z > 0.
/** Deck height above the still waterline; clears the tallest wave crest. */
const DECK_HEIGHT = 2.4;
/** Hulls longer than this berth alongside the quay instead of in a slip. */
const MAX_SLIP_LENGTH = 45;

/**
 * How the player is meant to park.
 * - `slip`: bow-in between two finger piers, like a marina.
 * - `alongside`: parallel against the quay, in a gap between two moored ships.
 */
export type BerthMode = 'slip' | 'alongside';

export interface Berth {
  centerX: number;
  centerZ: number;
  halfWidth: number;
  halfDepth: number;
  mode: BerthMode;
  /** Heading the hull must settle to. */
  targetHeading: number;
  /** Alongside berths accept either way round; slips do not. */
  allowReverseHeading: boolean;
  /** Water-side mouth of the berth, where the lead-in arrow starts. */
  entranceZ: number;
}

/** Axis-aligned footprint the hull must not drive through. */
export interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface BuoyInstance {
  x: number;
  z: number;
  radius: number;
  mesh: THREE.Group;
}

interface MooredBoat {
  group: THREE.Group;
  x: number;
  z: number;
  /** Wave response, damped for bigger hulls. */
  response: number;
}

interface SlipPlan {
  centerX: number;
  width: number;
  occupant: BoatSpec | null;
  isPlayer: boolean;
  length: number;
}

const PLANK = new THREE.MeshStandardMaterial({ color: '#77573a', roughness: 0.86, metalness: 0.02 });
const PILING = new THREE.MeshStandardMaterial({ color: '#4c3826', roughness: 0.9, metalness: 0.02 });
const FENDER = new THREE.MeshStandardMaterial({ color: '#1d2430', roughness: 0.82, metalness: 0.04 });

/**
 * Find the top of a pier's walking deck — the surface you would walk on, not
 * the top of the bollard standing on it.
 *
 * Rays are dropped over the footprint and the median first hit taken. Bollards,
 * cleats and posts cover only a little of the deck, so they never outvote it,
 * and a deck built from a handful of big quads is found just as reliably as a
 * finely tessellated one. Measuring how much of the footprint each height band
 * spans instead fails here: bollards scattered along a quay span nearly all of
 * it while covering almost none of it, and the deck ends up seated two metres
 * low with the sea washing over the planking.
 */
function findDeckTop(model: THREE.Object3D): number {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  const startY = bounds.max.y + Math.max(size.x, size.z) + 1;

  const GRID = 11;
  const hits: number[] = [];
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      // Inset from the rim: rays down the very edge catch fenders and pilings.
      const alongX = 0.08 + (i / (GRID - 1)) * 0.84;
      const alongZ = 0.08 + (j / (GRID - 1)) * 0.84;
      origin.set(bounds.min.x + size.x * alongX, startY, bounds.min.z + size.z * alongZ);
      raycaster.set(origin, down);
      const hit = raycaster.intersectObject(model, true)[0];
      if (hit) hits.push(hit.point.y);
    }
  }
  if (hits.length < 8) return bounds.max.y;
  hits.sort((a, b) => a - b);
  return hits[Math.floor(hits.length / 2)];
}

/**
 * A working marina: one long quay with finger piers running out into the water,
 * slips between them holding other people's boats, and a painted arrow leading
 * into the one berth that is yours. Vessels too big for a slip get an alongside
 * berth in a gap between two moored ships instead.
 */
export class Harbor {
  readonly group = new THREE.Group();
  /** Height of the walking deck. Foam drawn above this reads as a flooded pier. */
  readonly deckHeight = DECK_HEIGHT;
  readonly buoys: BuoyInstance[] = [];
  /** Piers and moored hulls the player has to thread between. */
  readonly obstacles: Obstacle[] = [];
  berth: Berth = {
    centerX: 0,
    centerZ: 8,
    halfWidth: 6,
    halfDepth: 4,
    mode: 'slip',
    targetHeading: Math.PI,
    allowReverseHeading: false,
    entranceZ: 12,
  };

  private readonly structureGroup = new THREE.Group();
  private readonly neighborGroup = new THREE.Group();
  private readonly buoyGroup = new THREE.Group();
  private berthMarker: THREE.Group | null = null;
  private arrow: THREE.Group | null = null;
  private arrowBaseY = 0.3;
  private readonly moored: MooredBoat[] = [];
  private dockMeshes: THREE.Object3D[] = [];
  private buoyTemplate: THREE.Object3D | null = null;
  private lastSpec: BoatSpec | null = null;
  private layoutSeed = 1;
  /** Bumped on every rebuild so late model loads for an old layout are dropped. */
  private layoutToken = 0;

  constructor() {
    this.buildQuay();
    this.group.add(this.structureGroup);
    this.group.add(this.neighborGroup);
    this.group.add(this.buoyGroup);
  }

  get dockFaceZ(): number {
    return DOCK_FACE_Z;
  }

  /** Replace the blockout quay with the generated dock model, tiled. */
  setDockModel(template: THREE.Object3D, tileLength: number, count: number): void {
    const bounds = new THREE.Box3().setFromObject(template);
    const size = bounds.getSize(new THREE.Vector3());
    // Long axis runs along the quay (world X).
    if (size.z > size.x) {
      template.rotateY(Math.PI / 2);
      bounds.setFromObject(template);
      bounds.getSize(size);
    }
    const scale = tileLength / Math.max(size.x, 0.001);
    template.scale.multiplyScalar(scale);
    bounds.setFromObject(template);
    const center = bounds.getCenter(new THREE.Vector3());
    const depth = bounds.getSize(new THREE.Vector3()).z;
    const deckTop = findDeckTop(template);
    template.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    for (const mesh of this.dockMeshes) {
      this.group.remove(mesh);
      disposeObject3D(mesh);
    }
    this.dockMeshes = [];

    const start = -((count - 1) / 2) * tileLength;
    for (let i = 0; i < count; i += 1) {
      const tile = template.clone(true);
      // Seat the walking deck at DECK_HEIGHT; water face flush with z = 0.
      tile.position.set(
        start + i * tileLength - center.x,
        DECK_HEIGHT - deckTop,
        -depth / 2 - center.z + DOCK_FACE_Z - 0.2,
      );
      this.group.add(tile);
      this.dockMeshes.push(tile);
    }
  }

  /** Replace procedural buoys with the generated buoy model. */
  setBuoyModel(template: THREE.Object3D): void {
    this.buoyTemplate = template;
    if (this.lastSpec) this.rebuildChannel(this.lastSpec);
  }

  /** Lay out the marina around the vessel the player is about to dock. */
  configureForBoat(spec: BoatSpec, seed = 1): void {
    this.lastSpec = spec;
    this.layoutSeed = seed;
    this.layoutToken += 1;
    this.clearLayout();

    if (spec.length <= MAX_SLIP_LENGTH) this.buildSlipMarina(spec);
    else this.buildAlongsideBerth(spec);

    this.rebuildBerthMarker(spec);
    this.rebuildArrow(spec);
    this.rebuildChannel(spec);
  }

  /** Mooring rest pose: bow-in for a slip, parallel for an alongside berth. */
  mooringPose(spec: BoatSpec): { x: number; z: number; heading: number } {
    if (this.berth.mode === 'slip') {
      return {
        x: this.berth.centerX,
        z: DOCK_FACE_Z + spec.length / 2 + 1.6,
        heading: Math.PI,
      };
    }
    return {
      x: this.berth.centerX,
      z: DOCK_FACE_Z + spec.beam / 2 + Math.max(1, spec.beam * 0.18),
      heading: Math.PI / 2,
    };
  }

  /** Float the buoys, moored hulls and painted marks on the swell. */
  update(time: number, water: Water): void {
    for (const buoy of this.buoys) {
      buoy.mesh.position.y = water.heightAt(buoy.x, buoy.z, time);
    }
    for (const boat of this.moored) {
      boat.group.position.y = water.heightAt(boat.x, boat.z, time) * boat.response;
    }
    if (this.berthMarker) {
      this.berthMarker.position.y = water.heightAt(this.berth.centerX, this.berth.centerZ, time);
    }
    if (this.arrow) {
      // Sample at the berth entrance, where the chevrons actually sit.
      const wave = water.heightAt(this.berth.centerX, this.berth.entranceZ, time);
      this.arrow.position.y = this.arrowBaseY + wave;
    }
  }

  isInsideBerth(x: number, z: number): boolean {
    const berth = this.berth;
    return (
      Math.abs(x - berth.centerX) <= berth.halfWidth &&
      z >= DOCK_FACE_Z + 0.2 &&
      Math.abs(z - berth.centerZ) <= berth.halfDepth
    );
  }

  /** World-space bounds of the quay structure, for waterline QA. */
  dockBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const mesh of this.dockMeshes) box.expandByObject(mesh);
    return box;
  }

  setBerthHighlight(active: boolean): void {
    if (!this.berthMarker) return;
    this.berthMarker.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshStandardMaterial).color.set(active ? '#79c267' : '#e8a83b');
      }
    });
  }

  dispose(): void {
    disposeObject3D(this.group);
  }

  // ---------------------------------------------------------------- layout

  private clearLayout(): void {
    for (const child of [...this.structureGroup.children]) {
      this.structureGroup.remove(child);
      disposeObject3D(child);
    }
    for (const child of [...this.neighborGroup.children]) {
      this.neighborGroup.remove(child);
      disposeObject3D(child);
    }
    // Both were children of structureGroup and are already disposed above.
    this.berthMarker = null;
    this.arrow = null;
    this.moored.length = 0;
    this.obstacles.length = 0;
  }

  /**
   * Marina layout: the player's slip sits at x = 0 with neighbouring slips
   * either side, each sized to whatever is moored in it, and a finger pier
   * between every pair.
   */
  private buildSlipMarina(spec: BoatSpec): void {
    const rng = createSeededRandom(this.layoutSeed * 977 + 13);
    const token = this.layoutToken;

    // Neighbours are drawn from hulls that plausibly share this marina.
    const candidates = FLEET.filter(
      (other) => other.length >= spec.length * 0.3 && other.length <= spec.length * 2.2,
    );
    const pick = (): BoatSpec | null => {
      if (!candidates.length) return null;
      // Leave roughly one slip in five empty, like the reference marina.
      if (rng() < 0.2) return null;
      return candidates[Math.floor(rng() * candidates.length) % candidates.length];
    };

    const slipWidth = (s: BoatSpec) => s.beam * 1.9 + 1.5;
    const plans: SlipPlan[] = [
      {
        centerX: 0,
        width: slipWidth(spec),
        occupant: null,
        isPlayer: true,
        length: spec.length,
      },
    ];

    const fingerWidth = THREE.MathUtils.clamp(spec.beam * 0.3, 0.7, 4);
    const SIDE_SLIPS = 3;
    for (const direction of [-1, 1]) {
      let edge = (slipWidth(spec) / 2) * direction;
      for (let i = 0; i < SIDE_SLIPS; i += 1) {
        const occupant = pick();
        const reference = occupant ?? spec;
        const width = slipWidth(reference);
        const centerX = edge + direction * (fingerWidth + width / 2);
        plans.push({ centerX, width, occupant, isPlayer: false, length: reference.length });
        edge = centerX + direction * (width / 2);
      }
    }

    plans.sort((a, b) => a.centerX - b.centerX);

    // A finger pier on both sides of every slip, shared between neighbours.
    const fingerXs = new Set<number>();
    for (const plan of plans) {
      fingerXs.add(+(plan.centerX - plan.width / 2 - fingerWidth / 2).toFixed(3));
      fingerXs.add(+(plan.centerX + plan.width / 2 + fingerWidth / 2).toFixed(3));
    }
    const fingerLength = Math.max(...plans.map((p) => p.length)) * 1.15;
    for (const x of fingerXs) {
      this.addFingerPier(x, fingerWidth, fingerLength);
    }

    // Fill the neighbouring slips.
    for (const plan of plans) {
      if (plan.isPlayer || !plan.occupant) continue;
      this.addMooredBoat(plan.occupant, plan.centerX, Math.PI, token);
    }

    // The hull counts as berthed only once it is well inside the slip, not
    // merely overlapping the mouth.
    this.berth = {
      centerX: 0,
      centerZ: spec.length * 0.5 + 1.6,
      halfWidth: slipWidth(spec) / 2,
      halfDepth: spec.length * 0.3,
      mode: 'slip',
      targetHeading: Math.PI,
      allowReverseHeading: false,
      entranceZ: fingerLength,
    };
  }

  /**
   * Alongside layout for hulls too big for a slip: a gap on the quay with a
   * ship moored ahead and astern, so the player parallel-parks between them.
   */
  private buildAlongsideBerth(spec: BoatSpec): void {
    const rng = createSeededRandom(this.layoutSeed * 613 + 29);
    const token = this.layoutToken;
    const gapHalf = spec.length * 0.62;

    const candidates = FLEET.filter((other) => other.length > MAX_SLIP_LENGTH);
    for (const direction of [-1, 1]) {
      const neighbor = candidates[Math.floor(rng() * candidates.length) % candidates.length];
      if (!neighbor) continue;
      const x = direction * (gapHalf + neighbor.length / 2 + spec.length * 0.08);
      this.addMooredBoat(neighbor, x, Math.PI / 2, token, neighbor.beam / 2 + 1.5);
    }

    this.berth = {
      centerX: 0,
      centerZ: spec.beam * 1.15,
      halfWidth: gapHalf,
      halfDepth: spec.beam * 1.15,
      mode: 'alongside',
      targetHeading: Math.PI / 2,
      allowReverseHeading: true,
      entranceZ: spec.beam * 2.3,
    };
  }

  private addFingerPier(x: number, width: number, length: number): void {
    const finger = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.45, length), PLANK);
    deck.position.set(x, DECK_HEIGHT - 0.22, length / 2);
    deck.castShadow = true;
    deck.receiveShadow = true;
    finger.add(deck);

    const pilingGeometry = new THREE.CylinderGeometry(
      width * 0.22,
      width * 0.25,
      DECK_HEIGHT + 2.6,
      8,
    );
    const step = Math.max(length / 6, width * 3);
    for (let z = step * 0.5; z < length; z += step) {
      for (const side of [-1, 1]) {
        const piling = new THREE.Mesh(pilingGeometry, PILING);
        piling.position.set(x + side * width * 0.32, DECK_HEIGHT - 1.5, z);
        piling.castShadow = true;
        finger.add(piling);
      }
    }

    // Rubber strip along both faces, at hull height.
    for (const side of [-1, 1]) {
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(width * 0.12, 0.35, length), FENDER);
      bumper.position.set(x + side * width * 0.5, DECK_HEIGHT - 0.55, length / 2);
      finger.add(bumper);
    }

    this.structureGroup.add(finger);
    this.obstacles.push({
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: DOCK_FACE_Z,
      maxZ: length,
    });
  }

  /**
   * Moor another vessel in the harbour. The model loads asynchronously, so the
   * footprint is reserved immediately and the hull dropped in when it arrives.
   */
  private addMooredBoat(
    spec: BoatSpec,
    x: number,
    heading: number,
    token: number,
    zOverride?: number,
  ): void {
    const bowIn = Math.abs(Math.sin(heading)) < 0.5;
    const z = zOverride ?? DOCK_FACE_Z + spec.length / 2 + 1.6;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    this.neighborGroup.add(group);
    this.moored.push({
      group,
      x,
      z,
      response: THREE.MathUtils.clamp(9 / spec.length, 0.08, 1) * 0.8,
    });

    const halfAlong = spec.length / 2;
    const halfAcross = spec.beam / 2 + 0.4;
    this.obstacles.push(
      bowIn
        ? { minX: x - halfAcross, maxX: x + halfAcross, minZ: z - halfAlong, maxZ: z + halfAlong }
        : { minX: x - halfAlong, maxX: x + halfAlong, minZ: z - halfAcross, maxZ: z + halfAcross },
    );

    loadMintModel(spec.mintKey)
      .then((model) => {
        if (token !== this.layoutToken) {
          disposeObject3D(model);
          return;
        }
        seatHullOnWater(model, spec);
        group.add(model);
      })
      .catch(() => {
        // A missing neighbour model is cosmetic; the berth footprint still holds.
      });
  }

  // ---------------------------------------------------------------- markings

  private rebuildBerthMarker(spec: BoatSpec): void {
    if (this.berthMarker) {
      this.structureGroup.remove(this.berthMarker);
      disposeObject3D(this.berthMarker);
    }
    const marker = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: '#e8a83b',
      roughness: 0.6,
      metalness: 0,
    });
    const berth = this.berth;
    const y = 0.45;
    const thickness = Math.max(0.35, spec.length * 0.012);

    // Marks are drawn in berth-local space; the group rides the swell.
    const front = new THREE.Mesh(
      new THREE.BoxGeometry(berth.halfWidth * 2, 0.18, thickness),
      material,
    );
    front.position.set(0, y, berth.halfDepth);
    marker.add(front);

    const sideGeometry = new THREE.BoxGeometry(thickness, 0.18, berth.halfDepth * 2);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(sideGeometry, material);
      rail.position.set(side * berth.halfWidth, y, 0);
      marker.add(rail);
    }

    marker.position.set(berth.centerX, 0, berth.centerZ);
    this.berthMarker = marker;
    this.structureGroup.add(marker);
  }

  /**
   * Painted chevrons on the water leading into the berth, largest nearest the
   * entrance, so the approach direction reads from a long way out.
   */
  private rebuildArrow(spec: BoatSpec): void {
    if (this.arrow) {
      this.structureGroup.remove(this.arrow);
      disposeObject3D(this.arrow);
    }
    const arrow = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: '#e8a83b',
      roughness: 0.55,
      metalness: 0,
    });

    // Capped, or a 300 m carrier gets chevrons the size of a city block.
    const width = THREE.MathUtils.clamp(spec.beam * 1.4, 3, 26);
    const length = THREE.MathUtils.clamp(spec.length * 0.7, 4, 55);
    const entrance = this.berth.entranceZ;
    const spacing = Math.max(length * 1.6, spec.length * 0.45);

    for (let i = 0; i < 3; i += 1) {
      const shrink = 1 - i * 0.18;
      const head = new THREE.Mesh(this.arrowGeometry(width * shrink, length * shrink), material);
      head.position.set(0, 0, entrance + spacing * (i + 0.8));
      arrow.add(head);
    }

    arrow.position.set(this.berth.centerX, this.arrowBaseY, 0);
    this.arrow = arrow;
    this.structureGroup.add(arrow);
  }

  /** A flat arrow polygon lying on the water, pointing toward the berth (-Z). */
  private arrowGeometry(width: number, length: number): THREE.BufferGeometry {
    const shaft = width * 0.3;
    const headLength = length * 0.45;
    const shape = new THREE.Shape();
    shape.moveTo(-shaft / 2, -length / 2);
    shape.lineTo(shaft / 2, -length / 2);
    shape.lineTo(shaft / 2, length / 2 - headLength);
    shape.lineTo(width / 2, length / 2 - headLength);
    shape.lineTo(0, length / 2);
    shape.lineTo(-width / 2, length / 2 - headLength);
    shape.lineTo(-shaft / 2, length / 2 - headLength);
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    // Shapes are built in XY; lay it flat so +Y becomes -Z, pointing at the dock.
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  private rebuildChannel(spec: BoatSpec): void {
    for (const buoy of this.buoys) {
      this.buoyGroup.remove(buoy.mesh);
      disposeObject3D(buoy.mesh);
    }
    this.buoys.length = 0;

    const approach = approachDistance(spec);
    const entrance = this.berth.entranceZ;
    const gate = Math.max(spec.beam * 3.5, spec.length * 0.8);
    const pairs = 3;
    for (let i = 1; i <= pairs; i += 1) {
      const z = entrance + (approach / (pairs + 1)) * i;
      const buoyScale = THREE.MathUtils.clamp(spec.length * 0.06, 0.8, 6);
      for (const side of [-1, 1]) {
        const mesh = this.createBuoyMesh(buoyScale);
        const x = this.berth.centerX + side * gate * (0.7 + i * 0.18);
        mesh.position.set(x, 0, z);
        this.buoyGroup.add(mesh);
        this.buoys.push({ x, z, radius: buoyScale * 1.1, mesh });
      }
    }
  }

  private createBuoyMesh(scale: number): THREE.Group {
    if (this.buoyTemplate) {
      const buoy = new THREE.Group();
      const clone = this.buoyTemplate.clone(true);
      const bounds = new THREE.Box3().setFromObject(clone);
      const size = bounds.getSize(new THREE.Vector3());
      const targetHeight = scale * 2.6;
      const factor = targetHeight / Math.max(size.y, 0.001);
      clone.scale.multiplyScalar(factor);
      bounds.setFromObject(clone);
      const center = bounds.getCenter(new THREE.Vector3());
      clone.position.set(-center.x, -bounds.min.y - targetHeight * 0.18, -center.z);
      clone.traverse((child) => {
        if (child instanceof THREE.Mesh) child.castShadow = true;
      });
      buoy.add(clone);
      return buoy;
    }

    const buoy = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: '#c2402f', roughness: 0.6, metalness: 0.08 });
    const white = new THREE.MeshStandardMaterial({ color: '#f2ede2', roughness: 0.62, metalness: 0.05 });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1, 12), red);
    base.position.y = 0.4;
    buoy.add(base);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.9, 0.7, 12), white);
    band.position.y = 1.2;
    buoy.add(band);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.1, 12), red);
    cone.position.y = 2.1;
    buoy.add(cone);

    buoy.scale.setScalar(scale);
    buoy.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });
    return buoy;
  }

  private buildQuay(): void {
    const quayLength = 1400;
    const quayDepth = 26;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(quayLength, 0.5, quayDepth), PLANK);
    deck.position.set(0, DECK_HEIGHT - 0.25, -quayDepth / 2);
    deck.receiveShadow = true;
    deck.castShadow = true;
    this.group.add(deck);
    this.dockMeshes.push(deck);

    const pilingGeometry = new THREE.CylinderGeometry(0.45, 0.5, DECK_HEIGHT + 2.4, 8);
    for (let x = -quayLength / 2 + 6; x <= quayLength / 2 - 6; x += 24) {
      const piling = new THREE.Mesh(pilingGeometry, PILING);
      piling.position.set(x, DECK_HEIGHT - 1.5, -0.9);
      piling.castShadow = true;
      this.group.add(piling);
      this.dockMeshes.push(piling);

      const fender = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.24, 8, 16), FENDER);
      fender.position.set(x, DECK_HEIGHT - 1.1, DOCK_FACE_Z + 0.1);
      fender.rotation.y = Math.PI / 2;
      this.group.add(fender);
      this.dockMeshes.push(fender);
    }
  }
}
