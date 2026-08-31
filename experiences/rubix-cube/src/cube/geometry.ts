import * as THREE from "three";
import {
  Axis,
  FACE_COLORS,
  FACE_NORMAL_LIST,
  FaceId,
  STICKER_OFFSET_RATIO,
  STICKER_RADIUS,
  STICKER_SCALE,
  Vec3i,
  WORLD_EXTENT,
  cubieSizeOf,
  spacingOf,
} from "./constants";
import { Cubie, CubeState, stickerColorOnLocalDir } from "./state";

/**
 * The Three.js mirror of the logical cube, for any size.
 *
 * Scene transforms are always written FROM the integer logical state, never
 * accumulated. That is what keeps the cube perfectly aligned after any number
 * of turns - float error from animation can never build up, because every
 * completed move ends with syncFromState() writing exact values.
 */

/** A rounded square lying in the XY plane, facing +Z. */
function stickerGeometry(size: number): THREE.BufferGeometry {
  const half = size / 2;
  const radius = size * STICKER_RADIUS;

  const shape = new THREE.Shape();
  shape.moveTo(-half + radius, -half);
  shape.lineTo(half - radius, -half);
  shape.quadraticCurveTo(half, -half, half, -half + radius);
  shape.lineTo(half, half - radius);
  shape.quadraticCurveTo(half, half, half - radius, half);
  shape.lineTo(-half + radius, half);
  shape.quadraticCurveTo(-half, half, -half, half - radius);
  shape.lineTo(-half, -half + radius);
  shape.quadraticCurveTo(-half, -half, -half + radius, -half);

  return new THREE.ShapeGeometry(shape, 8);
}

export class CubeView {
  readonly group = new THREE.Group();

  private readonly objects = new Map<Cubie, THREE.Object3D>();
  private readonly stickerGeo: THREE.BufferGeometry;
  private readonly stickerMaterials = new Map<number, THREE.Material>();
  private readonly quaternion = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();
  private readonly halfSpacing: number;
  private readonly cubieSize: number;

  constructor(
    private readonly state: CubeState,
    template: THREE.Object3D,
  ) {
    const n = state.n;
    this.cubieSize = cubieSizeOf(n);
    // Positions are doubled, so world position is coord * spacing / 2.
    this.halfSpacing = spacingOf(n) / 2;

    this.stickerGeo = stickerGeometry(this.cubieSize * STICKER_SCALE);

    for (const face of Object.keys(FACE_COLORS) as FaceId[]) {
      const color = FACE_COLORS[face];
      if (this.stickerMaterials.has(color)) continue;
      this.stickerMaterials.set(
        color,
        // Flat opaque paint: no emissive, no sheen, no environment response.
        new THREE.MeshLambertMaterial({ color, side: THREE.FrontSide }),
      );
    }

    for (const cubie of state.cubies) {
      const holder = new THREE.Group();
      holder.userData.cubie = cubie;

      // The template is normalised to a unit cube, so one scale fits any size.
      const shell = template.clone(true);
      shell.scale.multiplyScalar(this.cubieSize);
      holder.add(shell);

      for (const [, normal] of FACE_NORMAL_LIST) {
        const color = stickerColorOnLocalDir(cubie.home, normal, state.extent);
        if (color === null) continue;
        holder.add(this.createSticker(normal, color));
      }

      this.objects.set(cubie, holder);
      this.group.add(holder);
    }

    this.syncFromState();
  }

  private createSticker(normal: Vec3i, color: number): THREE.Mesh {
    const material = this.stickerMaterials.get(color);
    if (!material) throw new Error(`No material for colour ${color}`);

    const mesh = new THREE.Mesh(this.stickerGeo, material);
    const dir = new THREE.Vector3(normal[0], normal[1], normal[2]);
    const offset =
      this.cubieSize / 2 + this.cubieSize * STICKER_OFFSET_RATIO;
    mesh.position.copy(dir).multiplyScalar(offset);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    mesh.userData.isSticker = true;
    return mesh;
  }

  objectFor(cubie: Cubie): THREE.Object3D {
    const object = this.objects.get(cubie);
    if (!object) throw new Error("No scene object for cubie");
    return object;
  }

  /** Scene objects belonging to a slice, for animating a layer turn. */
  layerObjects(axis: Axis, layer: number): THREE.Object3D[] {
    return this.state.cubies
      .filter((c) => c.pos[axis] === layer)
      .map((c) => this.objectFor(c));
  }

  /**
   * Write every cubie's transform from the integer state. Called after each
   * completed move, which re-quantises the scene and discards any drift the
   * animation introduced.
   */
  syncFromState(): void {
    for (const cubie of this.state.cubies) {
      const object = this.objectFor(cubie);

      object.position.set(
        cubie.pos[0] * this.halfSpacing,
        cubie.pos[1] * this.halfSpacing,
        cubie.pos[2] * this.halfSpacing,
      );

      // orient holds the world directions of the cubie's local axes, which is
      // exactly the rotation matrix's columns.
      const o = cubie.orient;
      this.matrix.set(
        o[0][0], o[1][0], o[2][0], 0,
        o[0][1], o[1][1], o[2][1], 0,
        o[0][2], o[1][2], o[2][2], 0,
        0, 0, 0, 1,
      );
      this.quaternion.setFromRotationMatrix(this.matrix);
      object.quaternion.copy(this.quaternion);
      object.updateMatrix();
    }
  }

  /** Every object a raycast should consider. */
  pickTargets(): THREE.Object3D[] {
    return [...this.objects.values()];
  }

  /** Walk up from an intersected mesh to the cubie holder. */
  cubieFromObject(object: THREE.Object3D): Cubie | null {
    let node: THREE.Object3D | null = object;
    while (node) {
      if (node.userData.cubie) return node.userData.cubie as Cubie;
      node = node.parent;
    }
    return null;
  }

  dispose(): void {
    this.stickerGeo.dispose();
    this.stickerMaterials.forEach((m) => m.dispose());
    this.stickerMaterials.clear();
    this.objects.clear();
    this.group.clear();
  }
}

/** Overall cube extent, used to frame the camera. Constant across sizes. */
export function cubeRadius(): number {
  return WORLD_EXTENT / 2;
}
