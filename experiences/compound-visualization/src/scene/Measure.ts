import * as THREE from "three";
import type { AtomHandle } from "./MoleculeBuilder";
import type { SceneManager } from "./SceneManager";

/**
 * Interactive measuring: pick two atoms for a bond length, three for an angle.
 * All visuals live in a dedicated group so they clear independently.
 */
export class Measure {
  private readonly group = new THREE.Group();
  private handles: AtomHandle[] = [];
  private selection: number[] = [];
  active = false;

  /** Reports a human-readable readout (or null when cleared) to the UI. */
  onReadout: (text: string | null) => void = () => {};

  constructor(private readonly sm: SceneManager) {
    this.sm.scene.add(this.group);
  }

  setMolecule(handles: AtomHandle[]): void {
    this.handles = handles;
    this.clear();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.clear();
  }

  handlePick(index: number): void {
    if (!this.active) return;
    const existing = this.selection.indexOf(index);
    if (existing !== -1) {
      this.selection.splice(existing, 1);
    } else {
      if (this.selection.length >= 3) this.selection = [];
      this.selection.push(index);
    }
    this.render();
  }

  clear(): void {
    this.selection = [];
    this.render();
  }

  private handle(i: number): AtomHandle | undefined {
    return this.handles.find((h) => h.index === i);
  }

  private render(): void {
    this.disposeGroup();
    for (const idx of this.selection) {
      const h = this.handle(idx);
      if (h) this.addMarker(h.position);
    }

    if (this.selection.length === 2) {
      const a = this.handle(this.selection[0]);
      const b = this.handle(this.selection[1]);
      if (a && b) {
        const d = a.position.distanceTo(b.position);
        this.addLine(a.position, b.position);
        this.addLabel(
          new THREE.Vector3().addVectors(a.position, b.position).multiplyScalar(0.5),
          `${d.toFixed(3)} Å`,
        );
        this.onReadout(`Distance: ${d.toFixed(3)} Å`);
      }
    } else if (this.selection.length === 3) {
      const a = this.handle(this.selection[0]);
      const v = this.handle(this.selection[1]);
      const c = this.handle(this.selection[2]);
      if (a && v && c) {
        const va = new THREE.Vector3().subVectors(a.position, v.position);
        const vc = new THREE.Vector3().subVectors(c.position, v.position);
        const angle = (va.angleTo(vc) * 180) / Math.PI;
        this.addLine(a.position, v.position);
        this.addLine(v.position, c.position);
        this.addLabel(v.position.clone().add(new THREE.Vector3(0, 0.4, 0)), `${angle.toFixed(1)}°`);
        this.onReadout(`Angle: ${angle.toFixed(1)}°`);
      }
    } else if (this.selection.length === 1) {
      this.onReadout("Pick a second atom for distance…");
    } else {
      this.onReadout(null);
    }
  }

  private addMarker(pos: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(0.16, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe14d,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this.group.add(mesh);
  }

  private addLine(a: THREE.Vector3, b: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineDashedMaterial({
      color: 0xffe14d,
      dashSize: 0.18,
      gapSize: 0.12,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    this.group.add(line);
  }

  private addLabel(pos: THREE.Vector3, text: string): void {
    const label = this.sm.makeLabel(text, "measure-label");
    label.position.copy(pos);
    this.group.add(label);
  }

  private disposeGroup(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      const el = (child as unknown as { element?: HTMLElement }).element;
      if (el) el.remove();
    }
  }
}
