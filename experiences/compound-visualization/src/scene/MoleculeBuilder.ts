import * as THREE from "three";
import type { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { AtomFinish, Molecule, RenderMode } from "../types";
import { getElement } from "../data/elements";
import { ATOM_FINISHES, RENDER_STYLES } from "./RenderModes";
import type { SceneManager } from "./SceneManager";

export interface AtomHandle {
  index: number;
  mesh: THREE.Mesh;
  baseColor: THREE.Color;
  /** World-space position (already centred). */
  position: THREE.Vector3;
}

export interface BuiltMolecule {
  atoms: AtomHandle[];
  center: THREE.Vector3;
  radius: number;
}

const SPHERE_SEGMENTS = 32;

export class MoleculeBuilder {
  constructor(private readonly sm: SceneManager) {}

  build(
    mol: Molecule,
    mode: RenderMode,
    showLabels: boolean,
    finish: AtomFinish,
  ): BuiltMolecule {
    this.sm.clearMolecule();
    const group = this.sm.molecule;
    const style = RENDER_STYLES[mode];
    const fin = ATOM_FINISHES[finish];

    // Centre the molecule on its centroid so it rotates in place.
    const centroid = new THREE.Vector3();
    for (const a of mol.atoms) centroid.add(new THREE.Vector3(a.x, a.y, a.z));
    if (mol.atoms.length) centroid.multiplyScalar(1 / mol.atoms.length);

    const positions = mol.atoms.map(
      (a) => new THREE.Vector3(a.x, a.y, a.z).sub(centroid),
    );

    const atoms: AtomHandle[] = [];
    let radius = 1;

    mol.atoms.forEach((a, i) => {
      const el = getElement(a.element);
      const r = (style.useVdw ? el.vdwRadius : el.covalentRadius) * style.atomScale;
      const geo = new THREE.SphereGeometry(r, SPHERE_SEGMENTS, SPHERE_SEGMENTS);
      const color = new THREE.Color(el.cpkColor);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: fin.roughness,
        metalness: fin.metalness,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(positions[i]);
      mesh.userData = { kind: "atom", index: i };
      mesh.castShadow = true;
      group.add(mesh);
      atoms.push({ index: i, mesh, baseColor: color.clone(), position: positions[i] });
      radius = Math.max(radius, positions[i].length() + r);

      if (showLabels) {
        const label = this.sm.makeLabel(el.symbol, "atom-label");
        label.position.copy(positions[i]);
        mesh.add(this.toLocal(label, mesh));
      }
    });

    if (style.showBonds && style.bondRadius > 0) {
      for (const bond of mol.bonds) {
        if (bond.a >= positions.length || bond.b >= positions.length) continue;
        this.buildBond(
          group,
          positions[bond.a],
          positions[bond.b],
          getElement(mol.atoms[bond.a].element).cpkColor,
          getElement(mol.atoms[bond.b].element).cpkColor,
          bond.order,
          style.bondRadius,
          bond.a,
          bond.b,
        );
      }
    }

    const center = new THREE.Vector3(0, 0, 0);
    return { atoms, center, radius };
  }

  /** A CSS2DObject is added as a child of the mesh; keep it at local origin. */
  private toLocal(label: CSS2DObject, _mesh: THREE.Mesh): CSS2DObject {
    label.position.set(0, 0, 0);
    return label;
  }

  private buildBond(
    group: THREE.Group,
    pa: THREE.Vector3,
    pb: THREE.Vector3,
    colorA: number,
    colorB: number,
    order: number,
    baseRadius: number,
    atomA: number,
    atomB: number,
  ): void {
    const dir = new THREE.Vector3().subVectors(pb, pa);
    const length = dir.length();
    if (length < 1e-4) return;

    // Offset direction for drawing multiple parallel cylinders.
    const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const offsetAxis = new THREE.Vector3().crossVectors(dir, up).normalize();
    const gap = baseRadius * 2.6;

    const bondGroup = new THREE.Group();
    bondGroup.userData = { kind: "bond", atomA, atomB };

    const count = order;
    for (let k = 0; k < count; k++) {
      const shift = (k - (count - 1) / 2) * gap;
      const off = offsetAxis.clone().multiplyScalar(shift);
      // Split each cylinder into two half-length segments, coloured per atom.
      this.halfCylinder(bondGroup, pa, pb, off, length, baseRadius, colorA, true);
      this.halfCylinder(bondGroup, pa, pb, off, length, baseRadius, colorB, false);
    }
    group.add(bondGroup);
  }

  private halfCylinder(
    parent: THREE.Group,
    pa: THREE.Vector3,
    pb: THREE.Vector3,
    offset: THREE.Vector3,
    length: number,
    radius: number,
    color: number,
    firstHalf: boolean,
  ): void {
    const geo = new THREE.CylinderGeometry(radius, radius, length / 2, 16);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);

    const start = firstHalf ? pa : new THREE.Vector3().lerpVectors(pa, pb, 0.5);
    const end = firstHalf ? new THREE.Vector3().lerpVectors(pa, pb, 0.5) : pb;
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5).add(offset);
    mesh.position.copy(mid);

    const axis = new THREE.Vector3().subVectors(pb, pa).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    mesh.userData = { kind: "bond-part" };
    mesh.castShadow = true;
    parent.add(mesh);
  }
}
