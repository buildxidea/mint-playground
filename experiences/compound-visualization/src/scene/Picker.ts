import * as THREE from "three";
import type { SceneManager } from "./SceneManager";

export interface AtomPick {
  kind: "atom";
  index: number;
  point: THREE.Vector3;
}
export interface BondPick {
  kind: "bond";
  atomA: number;
  atomB: number;
}
export type Pick = AtomPick | BondPick | null;

/** Raycasts pointer events against the current molecule group. */
export class Picker {
  private readonly ray = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly canvas: HTMLCanvasElement;

  onHover: (pick: Pick) => void = () => {};
  onClick: (pick: Pick) => void = () => {};

  constructor(private readonly sm: SceneManager) {
    this.canvas = sm.renderer.domElement as HTMLCanvasElement;
    this.canvas.addEventListener("pointermove", this.handleMove);
    this.canvas.addEventListener("pointerdown", this.handleDown);
    this.canvas.addEventListener("pointerup", this.handleUp);
  }

  private downPos = { x: 0, y: 0 };

  private setPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pick(): Pick {
    this.ray.setFromCamera(this.pointer, this.sm.camera);
    const hits = this.ray.intersectObjects(this.sm.molecule.children, true);
    for (const hit of hits) {
      const found = this.resolve(hit.object);
      if (found) {
        if (found.kind === "atom") {
          return { kind: "atom", index: found.index, point: hit.point.clone() };
        }
        return { kind: "bond", atomA: found.atomA, atomB: found.atomB };
      }
    }
    return null;
  }

  private resolve(
    obj: THREE.Object3D,
  ): { kind: "atom"; index: number } | { kind: "bond"; atomA: number; atomB: number } | null {
    let o: THREE.Object3D | null = obj;
    while (o) {
      const d = o.userData;
      if (d?.kind === "atom") return { kind: "atom", index: d.index };
      if (d?.kind === "bond") return { kind: "bond", atomA: d.atomA, atomB: d.atomB };
      o = o.parent;
    }
    return null;
  }

  private handleMove = (e: PointerEvent): void => {
    this.setPointer(e);
    this.onHover(this.pick());
  };

  private handleDown = (e: PointerEvent): void => {
    this.downPos = { x: e.clientX, y: e.clientY };
  };

  private handleUp = (e: PointerEvent): void => {
    // Treat as a click only when the pointer barely moved (not an orbit drag).
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    if (moved > 5) return;
    this.setPointer(e);
    this.onClick(this.pick());
  };

  dispose(): void {
    this.canvas.removeEventListener("pointermove", this.handleMove);
    this.canvas.removeEventListener("pointerdown", this.handleDown);
    this.canvas.removeEventListener("pointerup", this.handleUp);
  }
}
