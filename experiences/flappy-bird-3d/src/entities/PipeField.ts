import * as THREE from 'three';
import type { LoadedModel } from '../assets/assets';
import { PIPE_LETHAL_DEPTH, TUNING } from '../game/tuning';

interface PipeHalf {
  /** Mint pipe model at true proportions, providing the rim at the gap. */
  mouth: THREE.Object3D;
  /** Plain shaft continuing the body out of frame. */
  shaft: THREE.Mesh;
}

interface PipePair {
  group: THREE.Group;
  bottom: PipeHalf;
  top: PipeHalf;
  materials: THREE.Material[];
  gapCenterY: number;
  scored: boolean;
}

// Top pipes must clear the top of the frustum even for the farthest pipe in
// the pool (~85 units ahead), where the 58° vertical view reaches ~41 above
// the camera — up to y≈52 with the bird at the ceiling. This leaves a wide
// margin at any camera height so a capped end is never visible.
const TOP_PIPE_REACH = 90;
const BOTTOM_PIPE_REACH = -6;
// Sink the shaft slightly into the mouth so the seam never cracks open.
const SEAM_OVERLAP = 0.05;

// Give the player a runway before the first pipe arrives.
const FIRST_PIPE_Z = -24;
// A passed pipe keeps sliding toward the camera, filling the screen between the
// player and the pipes ahead. Hide it as soon as it is harmless: the fade opens
// exactly where a collision stops being possible, so a pipe is fully solid for
// every frame it could kill the bird and gone almost immediately after. Never
// bring FADE_START_Z inside PIPE_LETHAL_DEPTH — that would let a pipe the
// player can no longer see still end the run.
const FADE_START_Z = PIPE_LETHAL_DEPTH;
// ~0.1s at the current scroll speed.
const FADE_END_Z = PIPE_LETHAL_DEPTH + 0.5;

/** Silhouette of the pipe model: overall height and the plain body radius. */
interface PipeProfile {
  height: number;
  bodyRadius: number;
  collarAtTop: boolean;
  /** Texture coordinate on the body, so the shaft can shade like it. */
  bodyUv: THREE.Vector2 | null;
}

/**
 * Measure the model's radius profile so a shaft can continue its body exactly.
 * The collar end is whichever end is widest; the body radius comes from the
 * opposite end. Radii are sampled from thin slabs at the two ends rather than
 * from slices up the body: the model is a low-poly tube whose sides carry
 * vertex rings only at their ends, so most interior slices are empty.
 */
function measureProfile(root: THREE.Object3D): PipeProfile {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const vertex = new THREE.Vector3();
  const endSlab = 0.1;

  const eachVertex = (
    visit: (y: number, radius: number, uv: THREE.Vector2 | null) => void,
  ) => {
    const scratchUv = new THREE.Vector2();
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const position = child.geometry.getAttribute('position');
      if (!position) return;
      const uvAttribute = child.geometry.getAttribute('uv');
      const toLocal = new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld);
      for (let i = 0; i < position.count; i += 1) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(toLocal);
        const uv = uvAttribute ? scratchUv.fromBufferAttribute(uvAttribute, i) : null;
        visit(vertex.y, Math.hypot(vertex.x, vertex.z), uv);
      }
    });
  };

  let minY = Infinity;
  let maxY = -Infinity;
  eachVertex((y) => {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });

  const height = maxY - minY;
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error('Pipe model has no measurable geometry.');
  }

  let lowRadius = 0;
  let highRadius = 0;
  let maxRadius = 0;
  eachVertex((y, radius) => {
    maxRadius = Math.max(maxRadius, radius);
    if (y <= minY + endSlab * height) lowRadius = Math.max(lowRadius, radius);
    if (y >= maxY - endSlab * height) highRadius = Math.max(highRadius, radius);
  });

  const collarAtTop = highRadius >= lowRadius;
  const measured = collarAtTop ? lowRadius : highRadius;
  // Guard against a model whose plain end is capped or bevelled to nothing.
  const bodyRadius = measured > 0.05 * maxRadius ? measured : 0.78 * maxRadius;

  // Average the plain end ring's texture coordinates. Only the outermost
  // vertices count: the pipe is a tube, and its dark inner wall shares that
  // end ring, so including it would sample the pipe's shadowed interior.
  // Averaging around the ring then lands mid-island rather than on a UV seam.
  const plainEndTest = collarAtTop
    ? (y: number) => y <= minY + endSlab * height
    : (y: number) => y >= maxY - endSlab * height;
  const uvSum = new THREE.Vector2();
  let uvCount = 0;
  eachVertex((y, radius, uv) => {
    if (!uv || !plainEndTest(y) || radius < 0.95 * bodyRadius) return;
    uvSum.add(uv);
    uvCount += 1;
  });
  const bodyUv = uvCount > 0 ? uvSum.divideScalar(uvCount) : null;

  return { height, bodyRadius, collarAtTop, bodyUv };
}

/**
 * Endless pipe corridor: a fixed pool of pipe pairs slides toward the camera
 * and each pair that passes behind it is recycled to the far end with a new
 * randomized gap height. Only poolSize pairs ever exist.
 */
export class PipeField {
  readonly group = new THREE.Group();

  private readonly pairs: PipePair[] = [];
  private readonly poolSize: number;
  private readonly mouthHeight: number;
  private readonly collarAtTop: boolean;

  constructor(pipeModel: LoadedModel, private rng: () => number) {
    const scale = (TUNING.pipeVisualRadius * 2) / Math.max(pipeModel.size.x, pipeModel.size.z);
    const profile = measureProfile(pipeModel.scene);
    this.mouthHeight = profile.height * scale;
    this.collarAtTop = profile.collarAtTop;
    const shaftRadius = profile.bodyRadius * scale;
    this.poolSize = Math.ceil((TUNING.recycleZ - TUNING.spawnFarZ) / TUNING.pipeSpacing) + 1;

    const shaftMaterial = this.findPipeMaterial(pipeModel.scene);
    // Unit-height cylinder centred on the origin; each half scales it to
    // length. Capped, so you cannot see straight through a pipe's mouth.
    const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, 1, 24);
    this.pinUvToBody(shaftGeometry, profile.bodyUv);

    for (let i = 0; i < this.poolSize; i += 1) {
      const group = new THREE.Group();
      // Each mouth is flipped as needed so its collar faces into the gap.
      const bottom = this.createHalf(
        pipeModel, scale, shaftGeometry, shaftMaterial, !profile.collarAtTop,
      );
      const top = this.createHalf(
        pipeModel, scale, shaftGeometry, shaftMaterial, profile.collarAtTop,
      );
      group.add(bottom.mouth, bottom.shaft, top.mouth, top.shaft);
      this.group.add(group);

      // Per-pair material clones so one pair can fade without affecting the
      // others; the authored material properties are otherwise untouched.
      const materials: THREE.Material[] = [];
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
          child.material = child.material.clone();
          materials.push(child.material);
        }
      });

      this.pairs.push({ group, bottom, top, materials, gapCenterY: 0, scored: false });
    }
    this.reset();
  }

  setRng(rng: () => number): void {
    this.rng = rng;
  }

  reset(): void {
    this.pairs.forEach((pair, index) => {
      pair.group.position.z = FIRST_PIPE_Z - index * TUNING.pipeSpacing;
      pair.scored = false;
      this.randomizeGap(pair);
      this.applyFade(pair);
    });
  }

  /** Slide pipes toward the camera; returns how many pairs the bird passed. */
  update(delta: number, birdY: number, birdRadius: number): { passed: number; hit: boolean } {
    let passed = 0;
    let hit = false;
    const wrapLength = this.poolSize * TUNING.pipeSpacing;
    const halfGap = TUNING.pipeGap / 2;

    for (const pair of this.pairs) {
      const previousZ = pair.group.position.z;
      let z = previousZ + TUNING.scrollSpeed * delta;

      if (z > TUNING.recycleZ) {
        z -= wrapLength;
        pair.scored = false;
        this.randomizeGap(pair);
      }
      pair.group.position.z = z;
      this.applyFade(pair);

      if (!pair.scored && previousZ < 0 && z >= 0) {
        pair.scored = true;
        passed += 1;
      }

      // Same threshold the fade keys off, so what is lethal and what is drawn
      // can never disagree.
      if (Math.abs(z) < PIPE_LETHAL_DEPTH) {
        const gapLow = pair.gapCenterY - halfGap;
        const gapHigh = pair.gapCenterY + halfGap;
        if (birdY - birdRadius < gapLow || birdY + birdRadius > gapHigh) {
          hit = true;
        }
      }
    }
    return { passed, hit };
  }

  /** Nearest pair the bird has not fully passed yet (for diagnostics/bots). */
  nextGapAhead(): { z: number; gapCenterY: number } | null {
    let best: { z: number; gapCenterY: number } | null = null;
    for (const pair of this.pairs) {
      const z = pair.group.position.z;
      if (z < 1 && (!best || z > best.z)) {
        best = { z, gapCenterY: pair.gapCenterY };
      }
    }
    return best;
  }

  private createHalf(
    pipeModel: LoadedModel,
    scale: number,
    shaftGeometry: THREE.CylinderGeometry,
    shaftMaterial: THREE.Material,
    flipped: boolean,
  ): PipeHalf {
    const mouth = pipeModel.scene.clone(true);
    mouth.scale.setScalar(scale);
    // Scaling stays uniform so the rim never distorts, however long the pipe.
    if (flipped) mouth.rotation.z = Math.PI;

    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
    return { mouth, shaft };
  }

  /**
   * Collapse the shaft's texture coordinates onto a tiny patch around the
   * model's own body texel. The shaft then shades exactly like the body it
   * continues — base colour, roughness and normal all come from the authored
   * maps — instead of stretching the whole texture atlas over itself, which
   * pulls in unrelated regions and shows a hard seam at the join. The patch is
   * kept small but non-zero so the tangent frame stays well defined.
   */
  private pinUvToBody(geometry: THREE.CylinderGeometry, bodyUv: THREE.Vector2 | null): void {
    if (!bodyUv) return;
    const uv = geometry.getAttribute('uv');
    if (!uv) return;
    const patch = 0.01;
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(
        i,
        bodyUv.x + (uv.getX(i) - 0.5) * patch,
        bodyUv.y + (uv.getY(i) - 0.5) * patch,
      );
    }
    uv.needsUpdate = true;
  }

  private findPipeMaterial(root: THREE.Object3D): THREE.Material {
    const materials: THREE.Material[] = [];
    root.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
        materials.push(child.material);
      }
    });
    const [first] = materials;
    if (!first) throw new Error('Pipe model has no material to extend.');
    // Share the authored material so the shaft matches the mouth exactly.
    return first;
  }

  private applyFade(pair: PipePair): void {
    const z = pair.group.position.z;
    const fade = 1 - THREE.MathUtils.clamp((z - FADE_START_Z) / (FADE_END_Z - FADE_START_Z), 0, 1);
    pair.group.visible = fade > 0;
    const fading = fade < 1;
    for (const material of pair.materials) {
      material.transparent = fading;
      material.opacity = fade;
      material.depthWrite = !fading;
    }
  }

  private randomizeGap(pair: PipePair): void {
    const gapCenterY = THREE.MathUtils.lerp(TUNING.gapCenterMin, TUNING.gapCenterMax, this.rng());
    pair.gapCenterY = gapCenterY;
    const halfGap = TUNING.pipeGap / 2;
    const gapLow = gapCenterY - halfGap;
    const gapHigh = gapCenterY + halfGap;

    // A flipped mouth hangs below its origin, an unflipped one sits above it,
    // so each anchors at a different end of its span.
    const bottomPlainEnd = gapLow - this.mouthHeight;
    const topPlainEnd = gapHigh + this.mouthHeight;

    // Bottom half: rim at the gap, body running down past the causeway edge.
    // Overshooting below y=0 is hidden by the terraces.
    pair.bottom.mouth.position.y = this.collarAtTop ? bottomPlainEnd : gapLow;
    this.spanShaft(pair.bottom.shaft, BOTTOM_PIPE_REACH, bottomPlainEnd + SEAM_OVERLAP);

    // Top half: rim at the gap, body running up out of frame.
    pair.top.mouth.position.y = this.collarAtTop ? topPlainEnd : gapHigh;
    this.spanShaft(pair.top.shaft, topPlainEnd - SEAM_OVERLAP, TOP_PIPE_REACH);
  }

  private spanShaft(shaft: THREE.Mesh, fromY: number, toY: number): void {
    const length = toY - fromY;
    if (length <= 0) {
      shaft.visible = false;
      return;
    }
    shaft.visible = true;
    shaft.scale.y = length;
    shaft.position.y = (fromY + toY) / 2;
  }
}
