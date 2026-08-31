import * as THREE from 'three';
import { getMintArtifactUrlByRole } from '../assets/MintAssetLibrary';
import { isInsideRoundedRink } from '../game/RinkShape';
import type { CoverageStats, LevelDefinition, ObstacleDefinition } from '../game/types';

export type ToolPose = {
  x: number;
  z: number;
  heading: number;
};

export type StampResult = {
  newCells: number;
  repeatedCells: number;
  wastedCells: number;
};

export type CoverageVisuals = {
  roughnessTexture: THREE.DataTexture;
  finishTexture: THREE.DataTexture;
  scuffTexture: THREE.CanvasTexture;
};

export type CoverageCellState = {
  playable: boolean;
  passCount: number;
  roughness: number;
  finishAlpha: number;
};

const GRID_WIDTH = 224;
const GRID_HEIGHT = 120;
const BLADE_WIDTH = 2.22;
const BLADE_DEPTH = 0.72;

const shortestAngle = (from: number, to: number): number => {
  let delta = (to - from + Math.PI) % (Math.PI * 2) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

export class CoverageSystem {
  readonly bladeWidth = BLADE_WIDTH;
  readonly gridWidth = GRID_WIDTH;
  readonly gridHeight = GRID_HEIGHT;

  private readonly playable = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);
  private readonly passCounts = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);
  private readonly lastTouched = new Uint32Array(GRID_WIDTH * GRID_HEIGHT);
  private sequence = 1;
  private cleanedCells = 0;
  private requiredCells = 0;
  private productiveCells = 0;
  private repeatedCells = 0;
  private wastedCells = 0;
  private visualRevision = 0;
  private readonly roughnessData = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 4);
  private roughnessTexture: THREE.DataTexture | null = null;
  private readonly finishData = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 4);
  private finishTexture: THREE.DataTexture | null = null;
  private scuffCanvas: HTMLCanvasElement | null = null;
  private scuffContext: CanvasRenderingContext2D | null = null;
  private scuffTexture: THREE.CanvasTexture | null = null;
  private mintScuffAtlas: HTMLCanvasElement | null = null;

  constructor(readonly level: LevelDefinition) {
    this.buildPlayableMask();
    this.initializeVisualData();
  }

  createVisuals(maxAnisotropy = 4): CoverageVisuals {
    const roughnessTexture = new THREE.DataTexture(
      this.roughnessData,
      GRID_WIDTH,
      GRID_HEIGHT,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    roughnessTexture.colorSpace = THREE.NoColorSpace;
    roughnessTexture.minFilter = THREE.LinearFilter;
    roughnessTexture.magFilter = THREE.LinearFilter;
    roughnessTexture.flipY = false;
    roughnessTexture.needsUpdate = true;

    const finishTexture = new THREE.DataTexture(
      this.finishData,
      GRID_WIDTH,
      GRID_HEIGHT,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    finishTexture.colorSpace = THREE.SRGBColorSpace;
    finishTexture.minFilter = THREE.LinearFilter;
    finishTexture.magFilter = THREE.LinearFilter;
    finishTexture.flipY = false;
    finishTexture.needsUpdate = true;

    const canvas = document.createElement('canvas');
    canvas.width = GRID_WIDTH * 3;
    canvas.height = GRID_HEIGHT * 3;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create ice scuff texture.');
    this.drawInitialScuffs(context, canvas.width, canvas.height);
    const scuffTexture = new THREE.CanvasTexture(canvas);
    scuffTexture.colorSpace = THREE.SRGBColorSpace;
    scuffTexture.anisotropy = Math.min(8, maxAnisotropy);
    scuffTexture.minFilter = THREE.LinearMipmapLinearFilter;
    scuffTexture.magFilter = THREE.LinearFilter;

    this.roughnessTexture = roughnessTexture;
    this.finishTexture = finishTexture;
    this.scuffCanvas = canvas;
    this.scuffContext = context;
    this.scuffTexture = scuffTexture;
    void this.loadMintScuffAtlas().catch((error: unknown) => {
      console.warn('Mint skate-mark decals could not be loaded.', error);
    });

    return { roughnessTexture, finishTexture, scuffTexture };
  }

  reset(): void {
    this.passCounts.fill(0);
    this.lastTouched.fill(0);
    this.sequence = 1;
    this.cleanedCells = 0;
    this.productiveCells = 0;
    this.repeatedCells = 0;
    this.wastedCells = 0;
    this.visualRevision = 0;
    this.initializeVisualData();
    if (this.roughnessTexture) this.roughnessTexture.needsUpdate = true;
    if (this.finishTexture) this.finishTexture.needsUpdate = true;
    if (this.scuffContext && this.scuffCanvas) {
      this.scuffContext.clearRect(0, 0, this.scuffCanvas.width, this.scuffCanvas.height);
      this.drawInitialScuffs(this.scuffContext, this.scuffCanvas.width, this.scuffCanvas.height);
      if (this.scuffTexture) this.scuffTexture.needsUpdate = true;
    }
  }

  stampSwept(previous: ToolPose, current: ToolPose, movedDistance: number): StampResult {
    const cellArea = ((this.level.halfWidth * 2) / GRID_WIDTH) * ((this.level.halfDepth * 2) / GRID_HEIGHT);
    const expectedCells = Math.max(1, Math.round((BLADE_WIDTH * Math.max(BLADE_DEPTH, movedDistance)) / cellArea));
    if (movedDistance < 0.018) {
      this.wastedCells += expectedCells;
      return { newCells: 0, repeatedCells: 0, wastedCells: expectedCells };
    }

    this.sequence += 1;
    const angleDelta = shortestAngle(previous.heading, current.heading);
    const steps = Math.max(1, Math.ceil(Math.max(movedDistance / 0.13, Math.abs(angleDelta) / 0.07)));
    const touchedThisStamp = new Set<number>();
    const result: StampResult = { newCells: 0, repeatedCells: 0, wastedCells: 0 };

    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const pose: ToolPose = {
        x: THREE.MathUtils.lerp(previous.x, current.x, t),
        z: THREE.MathUtils.lerp(previous.z, current.z, t),
        heading: previous.heading + angleDelta * t,
      };
      this.stampPose(pose, touchedThisStamp, result);
      this.clearScuffsAtPose(pose);
    }

    const shortfall = Math.max(0, expectedCells - touchedThisStamp.size);
    result.wastedCells += shortfall;
    this.productiveCells += result.newCells;
    this.repeatedCells += result.repeatedCells;
    this.wastedCells += result.wastedCells;
    if (result.newCells > 0) {
      this.visualRevision += 1;
      if (this.roughnessTexture) this.roughnessTexture.needsUpdate = true;
      if (this.finishTexture) this.finishTexture.needsUpdate = true;
    }
    if (this.scuffTexture) this.scuffTexture.needsUpdate = true;
    return result;
  }

  getStats(): CoverageStats {
    return {
      coverage: this.cleanedCells / Math.max(1, this.requiredCells),
      cleanedCells: this.cleanedCells,
      requiredCells: this.requiredCells,
      productiveCells: this.productiveCells,
      repeatedCells: this.repeatedCells,
      wastedCells: this.wastedCells,
      overlapRatio: this.repeatedCells / Math.max(1, this.productiveCells + this.repeatedCells),
    };
  }

  getVisualRevision(): number {
    return this.visualRevision;
  }

  getCellStateAtWorld(x: number, z: number): CoverageCellState | null {
    const { column, row } = this.worldToCell(x, z);
    if (column < 0 || column >= GRID_WIDTH || row < 0 || row >= GRID_HEIGHT) return null;
    const index = row * GRID_WIDTH + column;
    return {
      playable: this.playable[index] === 1,
      passCount: this.passCounts[index],
      roughness: this.roughnessData[index * 4],
      finishAlpha: this.finishData[index * 4 + 3],
    };
  }

  setCoverageForTest(target: number): void {
    const clamped = Math.max(0, Math.min(1, target));
    let cleaned = 0;
    const goal = Math.floor(this.requiredCells * clamped);
    for (let row = 0; row < GRID_HEIGHT && cleaned < goal; row += 1) {
      for (let column = 0; column < GRID_WIDTH && cleaned < goal; column += 1) {
        const index = row * GRID_WIDTH + column;
        if (!this.playable[index] || this.passCounts[index]) continue;
        this.passCounts[index] = 1;
        this.markRoughness(index, 65);
        cleaned += 1;
      }
    }
    this.cleanedCells = cleaned;
    this.productiveCells = cleaned;
    this.visualRevision += cleaned > 0 ? 1 : 0;
    if (this.roughnessTexture) this.roughnessTexture.needsUpdate = true;
    if (this.finishTexture) this.finishTexture.needsUpdate = true;
    if (this.scuffContext && this.scuffCanvas) {
      const cleanHeight = this.scuffCanvas.height * clamped;
      this.scuffContext.clearRect(0, 0, this.scuffCanvas.width, cleanHeight);
      if (this.scuffTexture) this.scuffTexture.needsUpdate = true;
    }
  }

  dispose(): void {
    this.roughnessTexture?.dispose();
    this.finishTexture?.dispose();
    this.scuffTexture?.dispose();
  }

  private buildPlayableMask(): void {
    for (let row = 0; row < GRID_HEIGHT; row += 1) {
      for (let column = 0; column < GRID_WIDTH; column += 1) {
        const { x, z } = this.cellToWorld(column, row);
        const outsideRink = !isInsideRoundedRink(x, z, this.level);
        const blocked = this.level.obstacles.some((obstacle) => this.pointInsideObstacle(x, z, obstacle, 0.16));
        const index = row * GRID_WIDTH + column;
        this.playable[index] = outsideRink || blocked ? 0 : 1;
        if (!outsideRink && !blocked) this.requiredCells += 1;
      }
    }
  }

  private stampPose(pose: ToolPose, touched: Set<number>, result: StampResult): void {
    const radius = Math.hypot(BLADE_WIDTH * 0.5, BLADE_DEPTH * 0.5);
    const min = this.worldToCell(pose.x - radius, pose.z + radius);
    const max = this.worldToCell(pose.x + radius, pose.z - radius);
    const minColumn = Math.max(0, Math.min(min.column, max.column));
    const maxColumn = Math.min(GRID_WIDTH - 1, Math.max(min.column, max.column));
    const minRow = Math.max(0, Math.min(min.row, max.row));
    const maxRow = Math.min(GRID_HEIGHT - 1, Math.max(min.row, max.row));
    const forwardX = Math.sin(pose.heading);
    const forwardZ = -Math.cos(pose.heading);
    const rightX = Math.cos(pose.heading);
    const rightZ = Math.sin(pose.heading);

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const index = row * GRID_WIDTH + column;
        if (touched.has(index)) continue;
        const world = this.cellToWorld(column, row);
        const dx = world.x - pose.x;
        const dz = world.z - pose.z;
        const localRight = dx * rightX + dz * rightZ;
        const localForward = dx * forwardX + dz * forwardZ;
        if (Math.abs(localRight) > BLADE_WIDTH * 0.5 || Math.abs(localForward) > BLADE_DEPTH * 0.5) continue;
        touched.add(index);

        if (!this.playable[index]) {
          result.wastedCells += 1;
          continue;
        }
        if (this.passCounts[index] === 0) {
          this.passCounts[index] = 1;
          this.lastTouched[index] = this.sequence;
          this.cleanedCells += 1;
          result.newCells += 1;
          this.markRoughness(index, 62);
          continue;
        }
        if (this.sequence - this.lastTouched[index] > 10) {
          this.passCounts[index] = Math.min(255, this.passCounts[index] + 1);
          result.repeatedCells += 1;
        }
        this.lastTouched[index] = this.sequence;
      }
    }
  }

  private markRoughness(index: number, value: number): void {
    const offset = index * 4;
    this.roughnessData[offset] = value;
    this.roughnessData[offset + 1] = value;
    this.roughnessData[offset + 2] = value;
    this.finishData[offset + 3] = 104;
  }

  private initializeVisualData(): void {
    for (let index = 0; index < this.playable.length; index += 1) {
      const offset = index * 4;
      const roughness = this.playable[index] ? 230 : 190;
      this.roughnessData[offset] = roughness;
      this.roughnessData[offset + 1] = roughness;
      this.roughnessData[offset + 2] = roughness;
      this.roughnessData[offset + 3] = 255;
      this.finishData[offset] = 115;
      this.finishData[offset + 1] = 226;
      this.finishData[offset + 2] = 244;
      this.finishData[offset + 3] = 0;
    }
  }

  private clearScuffsAtPose(pose: ToolPose): void {
    if (!this.scuffContext || !this.scuffCanvas) return;
    const u = (pose.x + this.level.halfWidth) / (this.level.halfWidth * 2);
    const v = (this.level.halfDepth - pose.z) / (this.level.halfDepth * 2);
    const width = (BLADE_WIDTH / (this.level.halfWidth * 2)) * this.scuffCanvas.width;
    const depth = (BLADE_DEPTH / (this.level.halfDepth * 2)) * this.scuffCanvas.height;
    this.scuffContext.save();
    this.scuffContext.globalCompositeOperation = 'destination-out';
    this.scuffContext.translate(u * this.scuffCanvas.width, v * this.scuffCanvas.height);
    this.scuffContext.rotate(-pose.heading);
    this.scuffContext.fillStyle = '#000';
    this.scuffContext.fillRect(-width * 0.54, -depth * 0.78, width * 1.08, depth * 1.56);
    this.scuffContext.restore();
  }

  private drawInitialScuffs(context: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.mintScuffAtlas) {
      this.drawMintScuffs(context, width, height);
      return;
    }
    let seed = 0x5eeda11;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    for (let index = 0; index < 1150; index += 1) {
      const x = random() * width;
      const y = random() * height;
      const angle = (random() - 0.5) * 1.35 + (random() > 0.5 ? 0 : Math.PI);
      const length = 5 + random() * 28;
      const bend = (random() - 0.5) * 12;
      context.strokeStyle = random() > 0.82 ? 'rgba(37,75,96,0.26)' : 'rgba(76,107,123,0.18)';
      context.lineWidth = 0.55 + random() * 1.35;
      context.beginPath();
      context.moveTo(x, y);
      context.quadraticCurveTo(
        x + Math.cos(angle) * length * 0.45 + bend,
        y + Math.sin(angle) * length * 0.45,
        x + Math.cos(angle) * length,
        y + Math.sin(angle) * length,
      );
      context.stroke();
    }
    context.fillStyle = 'rgba(55,89,105,0.045)';
    for (let index = 0; index < 480; index += 1) {
      const size = 1 + random() * 4;
      context.fillRect(random() * width, random() * height, size, size * 0.35);
    }
  }

  private async loadMintScuffAtlas(): Promise<void> {
    const image = new Image();
    image.decoding = 'async';
    image.src = getMintArtifactUrlByRole('skate-mark-decals', 'image');
    await image.decode();
    if (!this.scuffContext || !this.scuffCanvas) return;

    const atlas = document.createElement('canvas');
    atlas.width = image.naturalWidth;
    atlas.height = image.naturalHeight;
    const context = atlas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, atlas.width, atlas.height);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const red = pixels.data[offset];
      const green = pixels.data[offset + 1];
      const blue = pixels.data[offset + 2];
      const high = Math.max(red, green, blue);
      const low = Math.min(red, green, blue);
      const chroma = high - low;
      const brightness = (red + green + blue) / 3;
      pixels.data[offset + 3] = chroma < 18 && brightness > 70 && brightness < 205 ? 0 : Math.min(235, chroma * 7 + Math.max(0, 155 - brightness) * 2);
    }
    context.putImageData(pixels, 0, 0);
    this.mintScuffAtlas = atlas;
    this.scuffContext.clearRect(0, 0, this.scuffCanvas.width, this.scuffCanvas.height);
    this.drawMintScuffs(this.scuffContext, this.scuffCanvas.width, this.scuffCanvas.height);
    const cellWidth = this.scuffCanvas.width / GRID_WIDTH;
    const cellHeight = this.scuffCanvas.height / GRID_HEIGHT;
    for (let index = 0; index < this.passCounts.length; index += 1) {
      if (this.passCounts[index] === 0) continue;
      const column = index % GRID_WIDTH;
      const row = Math.floor(index / GRID_WIDTH);
      this.scuffContext.clearRect(column * cellWidth, row * cellHeight, cellWidth + 1, cellHeight + 1);
    }
    if (this.scuffTexture) this.scuffTexture.needsUpdate = true;
  }

  private drawMintScuffs(context: CanvasRenderingContext2D, width: number, height: number): void {
    const atlas = this.mintScuffAtlas;
    if (!atlas) return;
    let seed = 0x5eeda11;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const sourceWidth = atlas.width / 4;
    const sourceHeight = atlas.height / 3;
    context.clearRect(0, 0, width, height);
    for (let index = 0; index < 390; index += 1) {
      const sprite = Math.floor(random() * 12);
      const drawWidth = 8 + random() * 34;
      const drawHeight = drawWidth * (0.55 + random() * 0.55);
      context.save();
      context.globalAlpha = 0.16 + random() * 0.32;
      context.translate(random() * width, random() * height);
      context.rotate((random() - 0.5) * Math.PI * 2);
      context.drawImage(
        atlas,
        (sprite % 4) * sourceWidth,
        Math.floor(sprite / 4) * sourceHeight,
        sourceWidth,
        sourceHeight,
        -drawWidth * 0.5,
        -drawHeight * 0.5,
        drawWidth,
        drawHeight,
      );
      context.restore();
    }
  }

  private worldToCell(x: number, z: number): { column: number; row: number } {
    return {
      column: Math.floor(((x + this.level.halfWidth) / (this.level.halfWidth * 2)) * GRID_WIDTH),
      row: Math.floor(((this.level.halfDepth - z) / (this.level.halfDepth * 2)) * GRID_HEIGHT),
    };
  }

  private cellToWorld(column: number, row: number): { x: number; z: number } {
    return {
      x: -this.level.halfWidth + ((column + 0.5) / GRID_WIDTH) * this.level.halfWidth * 2,
      z: this.level.halfDepth - ((row + 0.5) / GRID_HEIGHT) * this.level.halfDepth * 2,
    };
  }

  private pointInsideObstacle(x: number, z: number, obstacle: ObstacleDefinition, padding: number): boolean {
    const dx = x - obstacle.x;
    const dz = z - obstacle.z;
    if (obstacle.shape.type === 'circle') {
      const radius = obstacle.shape.radius + padding;
      return dx * dx + dz * dz <= radius * radius;
    }
    const rotation = obstacle.rotation ?? 0;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const localX = dx * cosine - dz * sine;
    const localZ = dx * sine + dz * cosine;
    return Math.abs(localX) <= obstacle.shape.halfWidth + padding && Math.abs(localZ) <= obstacle.shape.halfDepth + padding;
  }
}
