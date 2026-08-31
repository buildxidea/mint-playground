import * as THREE from 'three';
import type { BoatSpec } from '../game/fleet';
import type { Water } from './Water';
import { disposeObject3D } from '../utils/dispose';
import { loadMintModel } from '../assets/ModelLibrary';

/**
 * Base course length in meters. Every hull now runs at the same speed, so the
 * run is a fixed distance rather than a multiple of the boat — a course that
 * scaled with hull length gave the dinghy gates 1.5 seconds apart.
 */
export const BASE_COURSE_LENGTH = 900;
/** Seconds added to your time for each gate you barge past. */
export const GATE_PENALTY_SECONDS = 15;

const GATE_COUNT = 5;

export interface Gate {
  index: number;
  x: number;
  z: number;
  halfWidth: number;
  /** null until the hull crosses the gate line. */
  cleared: boolean | null;
}

/**
 * A gated slalom running in from open water to the harbour mouth.
 *
 * Gates zigzag across the approach and are sized to the hull, so every vessel
 * runs the same shape — the dinghy threads gates a few boat-lengths apart while
 * the carrier's are most of a kilometre. Missing one costs time, never the run.
 */
export class Course {
  readonly group = new THREE.Group();
  readonly gates: Gate[] = [];
  startZ = 0;
  entranceZ = 0;
  private markerTemplate: THREE.Object3D | null = null;
  private readonly markerGroup = new THREE.Group();
  private nextGate = 0;
  private missed = 0;
  private activeBar: THREE.Mesh | null = null;
  private layoutToken = 0;
  private markerScale = 1;

  constructor() {
    this.group.add(this.markerGroup);
  }

  /** Number of gates cleared cleanly so far. */
  get cleared(): number {
    return this.gates.filter((gate) => gate.cleared === true).length;
  }

  get missedCount(): number {
    return this.missed;
  }

  get total(): number {
    return this.gates.length;
  }

  /** The gate the player is heading for, or null once they are all behind. */
  get pendingGate(): Gate | null {
    return this.gates[this.nextGate] ?? null;
  }

  /** Length of the run from open water to the harbour mouth. */
  get length(): number {
    return Math.max(this.startZ - this.entranceZ, 1);
  }

  /** Seconds added to the run for gates barged past. */
  get penaltySeconds(): number {
    return this.missed * GATE_PENALTY_SECONDS;
  }

  setMarkerModel(template: THREE.Object3D): void {
    this.markerTemplate = template;
    this.rebuildMarkers();
  }

  /**
   * Lay out the course between open water and the harbour mouth.
   * `entranceZ` is the water-side mouth of the berth.
   */
  configure(spec: BoatSpec, entranceZ: number, berthX: number): void {
    this.layoutToken += 1;
    this.gates.length = 0;
    this.nextGate = 0;
    this.missed = 0;

    // Long hulls still get more room, just not proportionally more.
    const totalLength = Math.max(BASE_COURSE_LENGTH, spec.length * 4);
    this.startZ = entranceZ + totalLength;
    this.entranceZ = entranceZ;
    const step = totalLength / (GATE_COUNT + 1);
    // Amplitude follows gate spacing, not hull length. Tied to length, the
    // carrier's weave asked for 1.4 km of lateral travel across 380 m of
    // forward run — geometrically impossible at any turn rate.
    const amplitude = step * 0.25;
    // A floor on gate width: a 6 m gap is untakeable at 30 m/s regardless of
    // how small the boat is.
    const halfWidth = Math.max(spec.beam * 2.5, spec.length * 0.3, 14);
    this.markerScale = Math.max(spec.beam * 0.6, 3);

    for (let i = 0; i < GATE_COUNT; i += 1) {
      const isLast = i === GATE_COUNT - 1;
      this.gates.push({
        index: i,
        // The final gate lines up with the berth so the course funnels in.
        x: isLast ? berthX : amplitude * (i % 2 === 0 ? 1 : -1),
        z: this.startZ - (i + 1) * step,
        halfWidth,
        cleared: null,
      });
    }

    this.rebuildMarkers();
  }

  /** Freeze gate progress so a retry can resume mid-course. */
  snapshotProgress(): { nextGate: number; missed: number; cleared: (boolean | null)[] } {
    return {
      nextGate: this.nextGate,
      missed: this.missed,
      cleared: this.gates.map((gate) => gate.cleared),
    };
  }

  restoreProgress(snap: { nextGate: number; missed: number; cleared: (boolean | null)[] }): void {
    this.nextGate = snap.nextGate;
    this.missed = snap.missed;
    this.gates.forEach((gate, i) => {
      gate.cleared = snap.cleared[i] ?? null;
    });
    this.moveActiveBar();
  }

  /** Where the run begins: out past the first gate, lined up with it. */
  spawnPose(): { x: number; z: number } {
    const first = this.gates[0];
    return { x: first ? first.x * 0.7 : 0, z: this.startZ };
  }

  /**
   * Watch for the hull crossing the next gate's line. Returns a result on the
   * frame a gate is decided so the caller can react.
   */
  update(boatX: number, boatZ: number): { gate: Gate; cleared: boolean } | null {
    const gate = this.gates[this.nextGate];
    if (!gate || boatZ > gate.z) return null;

    const cleared = Math.abs(boatX - gate.x) <= gate.halfWidth;
    gate.cleared = cleared;
    if (!cleared) this.missed += 1;
    this.nextGate += 1;
    this.moveActiveBar();
    return { gate, cleared };
  }

  /** Float the gate markers on the swell. */
  updateFloat(time: number, water: Water): void {
    for (const child of this.markerGroup.children) {
      child.position.y = water.heightAt(child.position.x, child.position.z, time);
    }
    if (this.activeBar) {
      const gate = this.gates[this.nextGate];
      if (gate) {
        this.activeBar.position.y =
          1.2 + water.heightAt(gate.x, gate.z, time);
      }
    }
  }

  dispose(): void {
    disposeObject3D(this.group);
  }

  private rebuildMarkers(): void {
    for (const child of [...this.markerGroup.children]) {
      this.markerGroup.remove(child);
      disposeObject3D(child);
    }
    this.activeBar = null;
    if (!this.gates.length) return;

    for (const gate of this.gates) {
      for (const side of [-1, 1]) {
        const marker = this.createMarker();
        marker.position.set(gate.x + side * gate.halfWidth, 0, gate.z);
        this.markerGroup.add(marker);
      }
    }

    // A bar spanning the gate the player is heading for next.
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: '#e8a83b', roughness: 0.6, metalness: 0 }),
    );
    bar.name = 'active-gate-bar';
    this.activeBar = bar;
    this.group.add(bar);
    this.moveActiveBar();
  }

  private moveActiveBar(): void {
    if (!this.activeBar) return;
    const gate = this.gates[this.nextGate];
    if (!gate) {
      this.activeBar.visible = false;
      return;
    }
    this.activeBar.visible = true;
    this.activeBar.position.set(gate.x, 1.2, gate.z);
    this.activeBar.scale.set(gate.halfWidth * 2, 1, 1);
  }

  private createMarker(): THREE.Object3D {
    if (this.markerTemplate) {
      const holder = new THREE.Group();
      const clone = this.markerTemplate.clone(true);
      const bounds = new THREE.Box3().setFromObject(clone);
      const size = bounds.getSize(new THREE.Vector3());
      const factor = (this.markerScale * 2.4) / Math.max(size.y, 0.001);
      clone.scale.multiplyScalar(factor);
      bounds.setFromObject(clone);
      const center = bounds.getCenter(new THREE.Vector3());
      clone.position.set(-center.x, -bounds.min.y - this.markerScale * 0.25, -center.z);
      clone.traverse((child) => {
        if (child instanceof THREE.Mesh) child.castShadow = true;
      });
      holder.add(clone);
      return holder;
    }

    // Blockout marker until the generated pylon arrives.
    const holder = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(this.markerScale * 0.12, this.markerScale * 0.16, this.markerScale * 2.4, 8),
      new THREE.MeshStandardMaterial({ color: '#e8b23b', roughness: 0.7, metalness: 0.1 }),
    );
    post.position.y = this.markerScale * 1.0;
    post.castShadow = true;
    holder.add(post);
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(this.markerScale * 0.7, this.markerScale * 0.7, 0.12),
      new THREE.MeshStandardMaterial({ color: '#1d2430', roughness: 0.7, metalness: 0.05 }),
    );
    top.position.y = this.markerScale * 2.2;
    holder.add(top);
    return holder;
  }
}

/** Load the generated gate pylon into a course. */
export function attachGateModel(course: Course): void {
  loadMintModel('gate-marker')
    .then((model) => course.setMarkerModel(model))
    .catch(() => {
      // Blockout markers stay; the course is still playable.
    });
}
