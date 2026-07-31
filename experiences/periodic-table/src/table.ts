import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import type { Background, BoardMaterial, ColorMode, ElementData, Finish } from './types';
import { CATEGORY_COLOR, MONO_TILE_COLOR } from './categories';
import { atlasUvRect, drawLegendPanel, drawTileAtlas, makeGlowTexture } from './textures';
import { LEGEND_ROWS } from './legend';

export const TILE = 0.94;
export const SPACING = 1.12;
const FBLOCK_GAP = 0.55;
/** Extra board height above the top row, reserved for the 3D title. */
const TITLE_BAND = 1.9;
/** World Y of the top edge of the first element row. */
const TABLE_TOP_Y = -(1 - 5.5) * SPACING + TILE / 2;
const TITLE_TEXT = 'PERIODIC TABLE';
/** The board is a thick slab; its front face stays here so tiles sit flush. */
const BOARD_FACE_Z = -0.02;
const BOARD_DEPTH = 0.7;
/** Capped at BOARD_DEPTH / 2 by RoundedBoxGeometry. */
const BOARD_RADIUS = 0.32;
const TILE_RADIUS = 0.15;

// --- legend board, standing to the right of the table -----------------------
const LEGEND_W = 4.4;
const LEGEND_H = 8.4;
const LEGEND_DEPTH = 0.45;
const LEGEND_ROW_H = 0.62;
const LEGEND_GAP = 0.9;
/** Half width of the main board, from the tile grid plus its margin. */
const MAIN_HALF_W = (18 * SPACING + 1.3) / 2;
const LEGEND_X = MAIN_HALF_W + LEGEND_GAP + LEGEND_W / 2;
const LEGEND_Y = 0.675;

/** Horizontal centre and half-width of everything on screen, for framing. */
export const SCENE_CENTER_X = (LEGEND_X + LEGEND_W / 2 - MAIN_HALF_W) / 2;
export const SCENE_HALF_W = (LEGEND_X + LEGEND_W / 2 + MAIN_HALF_W) / 2 + 0.5;

interface BoardPreset {
  /** Logical key registered in mint-assets.json. */
  key: string;
  repeat: [number, number];
  metalness: number;
  roughness: number;
  /** shown while the maps load, and multiplied into the base color */
  tint: number;
  tintOnWhite: number;
  /** inlaid title lettering, toned to sit with the board rather than shout */
  titleTint: number;
  titleTintOnWhite: number;
  titleMetalness: number;
  titleRoughness: number;
}

const BOARD_PRESETS: Record<BoardMaterial, BoardPreset> = {
  wood: {
    key: 'wood-board',
    repeat: [3, 1.8],
    metalness: 0,
    roughness: 1,
    tint: 0xd8d2ca,
    tintOnWhite: 0xffffff,
    // warm brass inlay: reads clearly against walnut without looking bolted on
    titleTint: 0xd9ad63,
    titleTintOnWhite: 0xc59a52,
    titleMetalness: 0.68,
    titleRoughness: 0.29,
  },
  plastic: {
    key: 'plastic-board',
    repeat: [2.6, 1.6],
    metalness: 0,
    roughness: 1,
    tint: 0xc4c8cf,
    tintOnWhite: 0xeceef2,
    titleTint: 0xf0f3f8,
    titleTintOnWhite: 0x7c828d,
    titleMetalness: 0.55,
    titleRoughness: 0.34,
  },
};

const BOARD_TEXTURE_URLS: Record<
  BoardMaterial,
  { basecolor: string; normal: string; roughness: string }
> = {
  wood: {
    basecolor:
      'https://cdn.mint.gg/materials/w17ex0r8e6dhjhgky758de0mrn8bfzh6/dark-wood-board-basecolor-f82380-a13c17eef3d009f9.png',
    normal:
      'https://cdn.mint.gg/materials/w17ex0r8e6dhjhgky758de0mrn8bfzh6/dark-wood-board-normal-18b7da-44c8abc46e560403.png',
    roughness:
      'https://cdn.mint.gg/materials/w17ex0r8e6dhjhgky758de0mrn8bfzh6/dark-wood-board-roughness-9e86d9-0c2f3647e069f560.png',
  },
  plastic: {
    basecolor:
      'https://cdn.mint.gg/materials/w1720ve6084ser8mwd4e9q0s518bfjwd/plastic-board-basecolor-58470a-225f048164934bda.png',
    normal:
      'https://cdn.mint.gg/materials/w1720ve6084ser8mwd4e9q0s518bfjwd/plastic-board-normal-b47aea-bed0ab4cce2db04d.png',
    roughness:
      'https://cdn.mint.gg/materials/w1720ve6084ser8mwd4e9q0s518bfjwd/plastic-board-roughness-0e4d4e-34874da26641ef5d.png',
  },
};

const FINISH_PRESETS: Record<Finish, Partial<THREE.MeshPhysicalMaterial>> = {
  glossy: { roughness: 0.16, metalness: 0.02, clearcoat: 0.6, clearcoatRoughness: 0.1 },
  matte: { roughness: 0.92, metalness: 0.0, clearcoat: 0.0, clearcoatRoughness: 0.0 },
  metallic: { roughness: 0.26, metalness: 0.92, clearcoat: 0.0, clearcoatRoughness: 0.0 },
  satin: { roughness: 0.45, metalness: 0.18, clearcoat: 0.45, clearcoatRoughness: 0.55 },
};

/** Rounded-rectangle outline centred on the origin, as a Shape or a hole Path. */
function roundedRectShape<T extends THREE.Shape | THREE.Path>(
  width: number,
  height: number,
  radius: number,
  Ctor: new () => T
): T {
  const path = new Ctor();
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, Math.min(width, height) / 2);
  path.moveTo(x + r, y);
  path.lineTo(x + width - r, y);
  path.quadraticCurveTo(x + width, y, x + width, y + r);
  path.lineTo(x + width, y + height - r);
  path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  path.lineTo(x + r, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

export function tilePosition(el: ElementData): THREE.Vector3 {
  const x = (el.xpos - 9.5) * SPACING;
  let y = -(el.ypos - 5.5) * SPACING;
  if (el.ypos >= 9) y -= FBLOCK_GAP; // detached f-block rows
  return new THREE.Vector3(x, y, 0);
}

export function tileDepth(el: ElementData): number {
  // subtle topography: denser elements stick out further
  let d = el.density ?? 4;
  if (el.densityUnit === 'g/L') d /= 1000;
  const t = Math.sqrt(THREE.MathUtils.clamp(d / 22.6, 0, 1));
  return 0.3 + 0.48 * t;
}

export interface DetailTile {
  group: THREE.Group;
  /** 0 = closed, 1 = fully open */
  setOpen(t: number): void;
  dispose(): void;
}

/**
 * The periodic table scene: instanced tile blocks, one merged text layer,
 * a backplane, lighting, hover lift and per-tile hide/show for the flap swap.
 */
export class TableScene {
  readonly scene = new THREE.Scene();
  readonly elements: ElementData[];

  private boxes: THREE.InstancedMesh;
  private boxMaterial: THREE.MeshPhysicalMaterial;
  private textMesh: THREE.Mesh;
  private textGeometry: THREE.BufferGeometry;
  private atlasTexture: THREE.CanvasTexture;
  private backplane: THREE.Mesh;
  private backplaneMaterial: THREE.MeshStandardMaterial;
  private boardKind: BoardMaterial = 'wood';
  private background: Background = 'black';
  private boardMaps = new Map<string, THREE.Texture[]>();
  private legendGroup = new THREE.Group();
  private legendDisposables: Array<{ dispose(): void }> = [];
  private titleGroup: THREE.Group | null = null;
  private titleMaterial: THREE.MeshStandardMaterial;
  private titleShadowMaterial: THREE.MeshBasicMaterial;
  private titleY = 0;

  private baseColors: THREE.Color[] = [];
  private lift: Float32Array;
  private liftTarget: Float32Array;
  private intro: Float32Array; // 0..1 per-tile intro scale
  private introTime = 0;
  private introDone = false;
  private hidden = new Set<number>();
  private hoverIndex = -1;

  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  constructor(elements: ElementData[], atlasCellPx: number) {
    this.elements = elements;
    const n = elements.length;
    this.lift = new Float32Array(n);
    this.liftTarget = new Float32Array(n);
    this.intro = new Float32Array(n);

    // tile blocks
    const boxGeo = new RoundedBoxGeometry(TILE, TILE, 1, 5, TILE_RADIUS);
    // damped env reflection: at full strength the studio map washes the
    // instance colours out to pastel
    this.boxMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      envMapIntensity: 0.55,
    });
    this.boxes = new THREE.InstancedMesh(boxGeo, this.boxMaterial, n);
    this.boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.boxes);

    // text layer: one merged geometry of 118 quads mapped into the atlas
    const atlasCanvas = drawTileAtlas(elements, atlasCellPx);
    this.atlasTexture = new THREE.CanvasTexture(atlasCanvas);
    this.atlasTexture.colorSpace = THREE.SRGBColorSpace;
    this.atlasTexture.anisotropy = 8;
    this.textGeometry = this.buildTextGeometry();
    const textMaterial = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      transparent: true,
      depthWrite: false,
    });
    this.textMesh = new THREE.Mesh(this.textGeometry, textMaterial);
    this.textMesh.renderOrder = 2;
    this.scene.add(this.textMesh);

    // backplane: swappable Mint board material, with a title band along the top
    const cols = 18;
    const rows = 10;
    const planeW = cols * SPACING + 1.3;
    const planeH = rows * SPACING + FBLOCK_GAP + 1.3 + TITLE_BAND;
    const planeGeo = new RoundedBoxGeometry(planeW, planeH, BOARD_DEPTH, 6, BOARD_RADIUS);
    // shares the board's texture maps so the lettering reads as milled from it
    this.titleMaterial = new THREE.MeshStandardMaterial({ color: 0x9c7d5e });
    this.titleShadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.backplaneMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d2ca });
    this.backplane = new THREE.Mesh(planeGeo, this.backplaneMaterial);
    // slab extends backwards so the front face stays flush under the tiles
    this.backplane.position.set(
      0,
      -(FBLOCK_GAP / 2) + TITLE_BAND / 2,
      BOARD_FACE_Z - BOARD_DEPTH / 2
    );
    this.scene.add(this.backplane);
    this.titleY = TABLE_TOP_Y + TITLE_BAND / 2 - 0.12;
    this.loadTitle();
    this.buildLegendBoard();

    // lighting: env map is set by the app; directionals add definition
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(7, 12, 10);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd8ff, 0.32);
    fill.position.set(-9, -4, 7);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));

    this.updateAllMatrices();
  }

  private buildTextGeometry(): THREE.BufferGeometry {
    const n = this.elements.length;
    const positions = new Float32Array(n * 4 * 3);
    const uvs = new Float32Array(n * 4 * 2);
    const indices: number[] = [];
    const half = (TILE * 0.99) / 2;

    this.elements.forEach((el, i) => {
      const p = tilePosition(el);
      const z = tileDepth(el) + 0.004;
      const corners = [
        [p.x - half, p.y - half, z],
        [p.x + half, p.y - half, z],
        [p.x + half, p.y + half, z],
        [p.x - half, p.y + half, z],
      ];
      const { u0, v0, u1, v1 } = atlasUvRect(i);
      const uvArr = [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ];
      for (let c = 0; c < 4; c++) {
        positions.set(corners[c], (i * 4 + c) * 3);
        uvs.set(uvArr[c], (i * 4 + c) * 2);
      }
      const b = i * 4;
      indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }

  /** Recompute one tile's instance matrix + text quad from lift/intro/hidden. */
  private updateTileMatrix(i: number): void {
    const el = this.elements[i];
    const p = tilePosition(el);
    const depth = tileDepth(el) * this.intro[i];
    const hidden = this.hidden.has(i) || this.intro[i] <= 0.001;
    const lift = this.lift[i];

    if (hidden) {
      this.dummy.position.set(p.x, p.y, 0);
      this.dummy.scale.setScalar(0.0001);
    } else {
      this.dummy.position.set(p.x, p.y, depth / 2 + lift);
      this.dummy.scale.set(1, 1, Math.max(depth, 0.001));
    }
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    this.boxes.setMatrixAt(i, this.dummy.matrix);

    const pos = this.textGeometry.attributes.position as THREE.BufferAttribute;
    const z = hidden ? -10 : depth + 0.004 + lift;
    for (let c = 0; c < 4; c++) pos.setZ(i * 4 + c, z);
    pos.needsUpdate = true;

    // brighten toward white while lifted
    const base = this.baseColors[i];
    if (base) {
      this.tmpColor.copy(base).lerp(new THREE.Color(0xffffff), Math.min(lift / 0.22, 1) * 0.45);
      this.boxes.setColorAt(i, this.tmpColor);
      if (this.boxes.instanceColor) this.boxes.instanceColor.needsUpdate = true;
    }
    this.boxes.instanceMatrix.needsUpdate = true;
  }

  private updateAllMatrices(): void {
    for (let i = 0; i < this.elements.length; i++) this.updateTileMatrix(i);
  }

  /**
   * Low-relief 3D lettering milled out of the board's title band: the letter
   * bases sit below the board face, they carry the board's own material, and a
   * flat darkened copy underneath fakes the contact shadow.
   */
  private loadTitle(): void {
    new FontLoader().load(
      `${import.meta.env.BASE_URL}fonts/helvetiker_bold.typeface.json`,
      (font: Font) => {
        const size = 0.82;
        const tracking = 0.2;
        const group = new THREE.Group();
        const placed: { geo: TextGeometry; x: number; width: number; height: number }[] = [];
        let cursor = 0;

        for (const char of TITLE_TEXT) {
          if (char === ' ') {
            cursor += size * 0.55;
            continue;
          }
          const geo = new TextGeometry(char, {
            font,
            size,
            depth: 0.13,
            curveSegments: 6,
            bevelEnabled: true,
            bevelThickness: 0.02,
            bevelSize: 0.016,
            bevelSegments: 3,
          });
          geo.computeBoundingBox();
          const bb = geo.boundingBox!;
          const width = bb.max.x - bb.min.x;
          const height = bb.max.y - bb.min.y;
          geo.translate(-bb.min.x, -bb.min.y, 0);
          placed.push({ geo, x: cursor, width, height });
          cursor += width + tracking;
        }

        const total = cursor - tracking;
        const shadowScale = 1.07;
        for (const { geo, x, width, height } of placed) {
          const letterX = x - total / 2;

          // contact shadow: flattened copy of the glyph, offset away from the key light
          const shadow = new THREE.Mesh(geo.clone(), this.titleShadowMaterial);
          shadow.scale.set(shadowScale, shadowScale, 0.001);
          shadow.position.set(
            letterX - ((shadowScale - 1) * width) / 2 - 0.03,
            -((shadowScale - 1) * height) / 2 - 0.04,
            0.038
          );
          shadow.renderOrder = 1;
          group.add(shadow);

          const mesh = new THREE.Mesh(geo, this.titleMaterial);
          mesh.position.set(letterX, 0, 0);
          mesh.renderOrder = 2;
          group.add(mesh);
        }

        // sink the letter bases into the board so they emerge from the surface
        group.position.set(0, this.titleY - size / 2, BOARD_FACE_Z - 0.035);
        this.titleGroup = group;
        this.scene.add(group);
      },
      undefined,
      () => {
        /* font unavailable: the board simply shows no title */
      }
    );
  }

  /**
   * The legend as a smaller board beside the table: same material, with a
   * raised 3D block per category and its label alongside.
   */
  private buildLegendBoard(): void {
    const firstRowY = LEGEND_H / 2 - 1.35;
    const blockX = -LEGEND_W / 2 + 0.62;
    const labelX = -LEGEND_W / 2 + 1.05;

    const boardGeo = new RoundedBoxGeometry(LEGEND_W, LEGEND_H, LEGEND_DEPTH, 5, 0.2);
    this.legendDisposables.push(boardGeo);
    const board = new THREE.Mesh(boardGeo, this.backplaneMaterial);
    board.position.z = -LEGEND_DEPTH / 2;
    this.legendGroup.add(board);

    // blocks share the tile material, so the finish setting applies to them too
    const blockGeo = new RoundedBoxGeometry(0.46, 0.46, 1, 4, 0.09);
    this.legendDisposables.push(blockGeo);
    const blocks = new THREE.InstancedMesh(blockGeo, this.boxMaterial, LEGEND_ROWS.length);
    const dummy = new THREE.Object3D();
    LEGEND_ROWS.forEach((row, i) => {
      dummy.position.set(blockX, firstRowY - i * LEGEND_ROW_H, 0.12);
      dummy.scale.set(1, 1, 0.24);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      blocks.setMatrixAt(i, dummy.matrix);
      blocks.setColorAt(i, new THREE.Color(CATEGORY_COLOR[row.key]));
    });
    blocks.instanceMatrix.needsUpdate = true;
    if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
    this.legendGroup.add(blocks);

    const canvas = drawLegendPanel(
      LEGEND_W,
      LEGEND_H,
      LEGEND_ROWS.map((r) => r.label),
      LEGEND_ROW_H,
      firstRowY,
      labelX
    );
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    this.legendDisposables.push(texture);
    const labelGeo = new THREE.PlaneGeometry(LEGEND_W, LEGEND_H);
    this.legendDisposables.push(labelGeo);
    const labelMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    this.legendDisposables.push(labelMat);
    const labels = new THREE.Mesh(labelGeo, labelMat);
    labels.position.z = 0.008;
    labels.renderOrder = 2;
    this.legendGroup.add(labels);

    this.legendGroup.position.set(LEGEND_X, LEGEND_Y, 0);
    this.scene.add(this.legendGroup);
  }

  /** Hidden in monochrome mode, where a colour key means nothing. */
  setLegendVisible(visible: boolean): void {
    this.legendGroup.visible = visible;
  }

  setBoard(kind: BoardMaterial): void {
    this.boardKind = kind;
    const preset = BOARD_PRESETS[kind];
    const mat = this.backplaneMaterial;
    mat.metalness = preset.metalness;
    mat.roughness = preset.roughness;
    this.applyBoardTint();

    const cached = this.boardMaps.get(preset.key);
    if (cached) {
      this.applyBoardMaps(cached);
      return;
    }

    const urls = BOARD_TEXTURE_URLS[kind];
    const loader = new THREE.TextureLoader();
    const load = (url: string, srgb: boolean) => {
      const tex = loader.load(url);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(preset.repeat[0], preset.repeat[1]);
      tex.anisotropy = 8;
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    const maps = [
      load(urls.basecolor, true),
      load(urls.normal, false),
      load(urls.roughness, false),
    ];
    this.boardMaps.set(preset.key, maps);
    // only apply if the user has not switched again while loading
    if (this.boardKind !== kind) return;
    this.applyBoardMaps(maps);
  }

  private applyBoardMaps(maps: THREE.Texture[]): void {
    const [base, normal, rough] = maps;
    const mat = this.backplaneMaterial;
    [mat.map, mat.normalMap, mat.roughnessMap] = [base, normal, rough];
    mat.needsUpdate = true;
  }

  private applyBoardTint(): void {
    const preset = BOARD_PRESETS[this.boardKind];
    const dark = this.background === 'black';
    this.backplaneMaterial.color.set(dark ? preset.tint : preset.tintOnWhite);
    const title = this.titleMaterial;
    title.color.set(dark ? preset.titleTint : preset.titleTintOnWhite);
    title.metalness = preset.titleMetalness;
    title.roughness = preset.titleRoughness;
    title.needsUpdate = true;
  }

  setColors(mode: ColorMode): void {
    this.baseColors = this.elements.map((el) =>
      new THREE.Color(mode === 'category' ? CATEGORY_COLOR[el.category] : MONO_TILE_COLOR)
    );
    this.elements.forEach((_, i) => {
      this.boxes.setColorAt(i, this.baseColors[i]);
    });
    if (this.boxes.instanceColor) this.boxes.instanceColor.needsUpdate = true;
  }

  setFinish(finish: Finish): void {
    Object.assign(this.boxMaterial, FINISH_PRESETS[finish]);
    this.boxMaterial.needsUpdate = true;
  }

  setBackground(bg: Background): void {
    this.background = bg;
    this.scene.background = new THREE.Color(bg === 'black' ? 0x050506 : 0xf2f2f4);
    this.applyBoardTint();
  }

  setHover(index: number): void {
    if (index === this.hoverIndex) return;
    if (this.hoverIndex >= 0) this.liftTarget[this.hoverIndex] = 0;
    this.hoverIndex = index;
    if (index >= 0 && !this.hidden.has(index)) this.liftTarget[index] = 0.22;
  }

  hideTile(index: number): void {
    this.hidden.add(index);
    this.lift[index] = 0;
    this.liftTarget[index] = 0;
    this.updateTileMatrix(index);
  }

  showTile(index: number): void {
    this.hidden.delete(index);
    this.updateTileMatrix(index);
  }

  pick(raycaster: THREE.Raycaster): number {
    const hits = raycaster.intersectObject(this.boxes);
    for (const h of hits) {
      if (h.instanceId !== undefined && !this.hidden.has(h.instanceId)) return h.instanceId;
    }
    return -1;
  }

  update(dt: number): void {
    // staggered intro rise
    if (!this.introDone) {
      this.introTime += dt;
      let allDone = true;
      for (let i = 0; i < this.elements.length; i++) {
        const el = this.elements[i];
        const delay = 0.15 + (el.xpos + el.ypos) * 0.045;
        const t = THREE.MathUtils.clamp((this.introTime - delay) / 0.6, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        if (Math.abs(eased - this.intro[i]) > 0.0005) {
          this.intro[i] = eased;
          this.updateTileMatrix(i);
        }
        if (t < 1) allDone = false;
      }
      if (allDone) this.introDone = true;
    }

    // hover lift easing
    for (let i = 0; i < this.elements.length; i++) {
      const diff = this.liftTarget[i] - this.lift[i];
      if (Math.abs(diff) > 0.0005) {
        this.lift[i] += diff * Math.min(dt * 10, 1);
        this.updateTileMatrix(i);
      }
    }
  }

  /**
   * Build the openable stand-in for one tile: colored walls, dark interior,
   * and a front flap hinged at its top edge that swings outward and up.
   */
  makeDetailTile(index: number): DetailTile {
    const el = this.elements[index];
    const p = tilePosition(el);
    const depth = tileDepth(el);
    const group = new THREE.Group();
    group.position.copy(p);

    const wallMat = this.boxMaterial.clone();
    wallMat.color.copy(this.baseColors[index] ?? new THREE.Color(0xcccccc));
    const darkMat = new THREE.MeshBasicMaterial({ color: 0x030305 });
    const disposables: Array<{ dispose(): void }> = [wallMat, darkMat];

    // one extruded frame: rounded outer silhouette with a rounded opening,
    // so the shell matches the rounded tiles and has no coincident faces
    const t = 0.075;
    const holeSize = TILE - t * 2;
    const frameShape = roundedRectShape(TILE, TILE, TILE_RADIUS, THREE.Shape) as THREE.Shape;
    frameShape.holes.push(
      roundedRectShape(holeSize, holeSize, Math.max(TILE_RADIUS - t, 0.04), THREE.Path)
    );
    const frameGeo = new THREE.ExtrudeGeometry(frameShape, {
      depth: depth - 0.03,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 2,
      curveSegments: 8,
    });
    disposables.push(frameGeo);
    const frame = new THREE.Mesh(frameGeo, wallMat);
    frame.position.z = 0.015;
    group.add(frame);

    // dark cavity, inset from the opening so no surface is coplanar with it
    const innerSize = holeSize - 0.012;
    const innerGeo = new THREE.BoxGeometry(innerSize, innerSize, depth * 0.98);
    disposables.push(innerGeo);
    const innerMat = new THREE.MeshBasicMaterial({ color: 0x020204, side: THREE.BackSide });
    disposables.push(innerMat);
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.z = depth * 0.49;
    group.add(inner);

    // faint glow deep inside, so the void reads as "something is in there"
    const glowTex = makeGlowTexture('rgba(255,190,140,1)');
    disposables.push(glowTex);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    disposables.push(glowMat);
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(TILE * 0.6);
    glow.position.z = 0.03;
    group.add(glow);

    // flap: hinged at the top-front edge, swings outward + up
    const flap = new THREE.Group();
    flap.position.set(0, TILE / 2 - t / 2, depth - 0.015);
    group.add(flap);

    const faceShape = roundedRectShape(TILE, TILE, TILE_RADIUS, THREE.Shape) as THREE.Shape;
    const faceGeo = new THREE.ShapeGeometry(faceShape, 8);
    disposables.push(faceGeo);
    const face = new THREE.Mesh(faceGeo, wallMat);
    face.position.y = -TILE / 2 + t / 2;
    face.position.z = 0.012;
    flap.add(face);

    const backGeo = new THREE.ShapeGeometry(faceShape, 8);
    disposables.push(backGeo);
    const flapBackMat = new THREE.MeshBasicMaterial({ color: 0x08080b, side: THREE.BackSide });
    disposables.push(flapBackMat);
    const back = new THREE.Mesh(backGeo, flapBackMat);
    back.position.copy(face.position);
    back.position.z = 0.011;
    flap.add(back);

    // element text on the flap face, sampled from the shared atlas
    const { u0, v0, u1, v1 } = atlasUvRect(index);
    const textGeo = new THREE.PlaneGeometry(TILE * 0.99, TILE * 0.99);
    disposables.push(textGeo);
    const uvAttr = textGeo.attributes.uv as THREE.BufferAttribute;
    const remap = [
      [u0, v1],
      [u1, v1],
      [u0, v0],
      [u1, v0],
    ];
    for (let i = 0; i < 4; i++) uvAttr.setXY(i, remap[i][0], remap[i][1]);
    const textMat = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      transparent: true,
      depthWrite: false,
    });
    disposables.push(textMat);
    const text = new THREE.Mesh(textGeo, textMat);
    text.position.copy(face.position);
    text.position.z = 0.016;
    text.renderOrder = 3;
    flap.add(text);

    this.scene.add(group);

    return {
      group,
      setOpen: (v: number) => {
        flap.rotation.x = -1.98 * v;
      },
      dispose: () => {
        this.scene.remove(group);
        for (const d of disposables) d.dispose();
      },
    };
  }

  dispose(): void {
    this.boxes.geometry.dispose();
    this.boxMaterial.dispose();
    this.textGeometry.dispose();
    (this.textMesh.material as THREE.Material).dispose();
    this.atlasTexture.dispose();
    (this.backplane.geometry as THREE.BufferGeometry).dispose();
    this.backplaneMaterial.dispose();
    this.titleMaterial.dispose();
    this.titleShadowMaterial.dispose();
    for (const d of this.legendDisposables) d.dispose();
    this.legendGroup.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    this.titleGroup?.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const maps of this.boardMaps.values()) for (const t of maps) t.dispose();
  }
}
