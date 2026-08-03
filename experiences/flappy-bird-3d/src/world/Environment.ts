import * as THREE from 'three';
import type { LoadedModel } from '../assets/assets';
import { TUNING } from '../game/tuning';

const STRIP_LENGTH = 220;
const WRAP_Z = 16;
const CLOUD_PARALLAX = 0.55;

// A narrow causeway over open water: step sideways and you drop into the sea.
// The edge is built from stacked terraces rather than vertical walls, because
// an outward-facing vertical face is never visible from a camera centred above
// the path — only these upward-facing ledges show the soil layers.
const GRASS_HALF_WIDTH = 1.75;
const SOIL_HALF_WIDTH = 2.35;
const SOIL_Y = -0.5;
const ROCK_HALF_WIDTH = 2.8;
const ROCK_Y = -1.25;
const SKIRT_BOTTOM = -5;
const WATER_Y = -2.4;

// World units covered by one tile of each scrolling texture.
const GRASS_TILE = 6;
const SOIL_TILE = 7;
const WATER_TILE = 26;
const WATER_PARALLAX = 0.32;

interface ScrollingProp {
  object: THREE.Object3D;
  speedFactor: number;
}

interface ScrollingTexture {
  texture: THREE.Texture;
  /** Tiles advanced per world unit travelled. */
  rate: number;
}

/**
 * A single grass-topped causeway running to the horizon across a bright
 * turquoise ocean, with puffy clouds drifting overhead. The causeway is a
 * static mesh whose textures scroll, so the corridor reads as endless without
 * any geometry recycling.
 */
export class Environment {
  readonly group = new THREE.Group();

  private readonly props: ScrollingProp[] = [];
  private readonly scrollers: ScrollingTexture[] = [];

  constructor(cloudModel: LoadedModel, rng: () => number) {
    this.buildOcean();
    this.buildCauseway();
    this.scatterClouds(cloudModel, rng);
  }

  update(delta: number): void {
    // Every scrolling surface is a horizontal plane where +v maps to world -Z,
    // so advancing the offset carries it toward the camera.
    for (const scroller of this.scrollers) {
      scroller.texture.offset.y += TUNING.scrollSpeed * delta * scroller.rate;
    }

    for (const prop of this.props) {
      prop.object.position.z += TUNING.scrollSpeed * prop.speedFactor * delta;
      if (prop.object.position.z > WRAP_Z) {
        prop.object.position.z -= STRIP_LENGTH;
      }
    }
  }

  private get stripCenterZ(): number {
    return WRAP_Z - STRIP_LENGTH / 2;
  }

  private buildOcean(): void {
    const texture = this.createWaterTexture();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    const span = 700;
    texture.repeat.set(span / WATER_TILE, span / WATER_TILE);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(span, span),
      new THREE.MeshStandardMaterial({
        map: texture,
        color: '#1fbcd6',
        // Kept fully non-metallic and fairly rough: the scene carries an
        // environment map for the chrome bird, and a shiny sea would soak it
        // up and lose its colour.
        roughness: 0.45,
        metalness: 0,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, WATER_Y, this.stripCenterZ);
    this.group.add(water);
    this.scrollers.push({ texture, rate: WATER_PARALLAX / WATER_TILE });
  }

  private buildCauseway(): void {
    const grass = this.addTerrace(
      GRASS_HALF_WIDTH,
      TUNING.groundY,
      this.createGrassTexture(),
      GRASS_TILE,
    );
    grass.receiveShadow = true;

    this.addTerrace(SOIL_HALF_WIDTH, SOIL_Y, this.createSoilTexture('#c08a4e'), SOIL_TILE);
    this.addTerrace(ROCK_HALF_WIDTH, ROCK_Y, this.createSoilTexture('#8b5c2c'), SOIL_TILE);

    // Solid skirt below the lowest terrace so the causeway keeps a dark
    // silhouette where it meets the water instead of showing sea underneath.
    const skirtMaterial = new THREE.MeshStandardMaterial({ color: '#5d3c1d', roughness: 1 });
    for (const side of [1, -1] as const) {
      const skirt = new THREE.Mesh(
        new THREE.PlaneGeometry(STRIP_LENGTH, ROCK_Y - SKIRT_BOTTOM),
        skirtMaterial,
      );
      skirt.rotation.y = (side * Math.PI) / 2;
      skirt.position.set(
        side * ROCK_HALF_WIDTH,
        (ROCK_Y + SKIRT_BOTTOM) / 2,
        this.stripCenterZ,
      );
      this.group.add(skirt);
    }
  }

  private addTerrace(
    halfWidth: number,
    y: number,
    texture: THREE.CanvasTexture,
    tile: number,
  ): THREE.Mesh {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // u spans the terrace exactly once so the texture's baked edge shading
    // lands on the real edges; v tiles along the length.
    texture.repeat.set(1, STRIP_LENGTH / tile);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(halfWidth * 2, STRIP_LENGTH),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, y, this.stripCenterZ);
    this.group.add(mesh);
    this.scrollers.push({ texture, rate: 1 / tile });
    return mesh;
  }

  private scatterClouds(cloudModel: LoadedModel, rng: () => number): void {
    const scale = 3.4 / Math.max(cloudModel.size.x, cloudModel.size.z);
    for (let i = 0; i < 16; i += 1) {
      const cloud = cloudModel.scene.clone(true);
      const side = i % 2 === 0 ? 1 : -1;
      const s = scale * (0.7 + rng() * 1.3);
      cloud.scale.setScalar(s);
      cloud.position.set(
        side * (5 + rng() * 18),
        9 + rng() * 6,
        -rng() * STRIP_LENGTH + WRAP_Z,
      );
      cloud.traverse((child) => {
        if (child instanceof THREE.Mesh) child.castShadow = false;
      });
      this.group.add(cloud);
      this.props.push({ object: cloud, speedFactor: CLOUD_PARALLAX });
    }
  }

  private createGrassTexture(): THREE.CanvasTexture {
    const size = 128;
    const context = this.createCanvas(size);
    context.fillStyle = '#6fd83c';
    context.fillRect(0, 0, size, size);

    context.fillStyle = 'rgba(96, 200, 48, 0.5)';
    for (let y = 0; y < size; y += 32) {
      context.fillRect(0, y, size, 15);
    }
    context.fillStyle = 'rgba(150, 236, 104, 0.5)';
    for (let i = 0; i < 44; i += 1) {
      context.fillRect((i * 37) % size, (i * 61) % size, 6, 3);
    }
    this.shadeEdges(context, size, 'rgba(38, 112, 22, 0.85)', 12);
    return this.finishTexture(context);
  }

  private createSoilTexture(base: string): THREE.CanvasTexture {
    const size = 128;
    const context = this.createCanvas(size);
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);

    // Mottled packed earth with embedded pebbles.
    context.fillStyle = 'rgba(255, 226, 180, 0.18)';
    for (let y = 0; y < size; y += 26) {
      context.fillRect(0, y, size, 11);
    }
    context.fillStyle = 'rgba(58, 34, 14, 0.4)';
    for (let i = 0; i < 40; i += 1) {
      context.beginPath();
      context.arc((i * 53) % size, (i * 29) % size, 2 + (i % 3), 0, Math.PI * 2);
      context.fill();
    }
    this.shadeEdges(context, size, 'rgba(48, 28, 12, 0.75)', 10);
    return this.finishTexture(context);
  }

  /** Darken the left/right margins so each terrace reads as a lit ledge. */
  private shadeEdges(
    context: CanvasRenderingContext2D,
    size: number,
    color: string,
    width: number,
  ): void {
    context.fillStyle = color;
    context.fillRect(0, 0, width, size);
    context.fillRect(size - width, 0, width, size);
  }

  private createWaterTexture(): THREE.CanvasTexture {
    const size = 256;
    const context = this.createCanvas(size);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size);

    // Pale swell lines over a white base; the material tints it turquoise.
    context.strokeStyle = 'rgba(214, 248, 255, 0.95)';
    context.lineWidth = 3;
    for (let i = 0; i < 7; i += 1) {
      const y = (i / 7) * size;
      context.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const wave = y + Math.sin((x / size) * Math.PI * 4 + i) * 7;
        if (x === 0) context.moveTo(x, wave);
        else context.lineTo(x, wave);
      }
      context.stroke();
    }
    context.fillStyle = 'rgba(120, 210, 232, 0.35)';
    for (let i = 0; i < 26; i += 1) {
      context.beginPath();
      context.ellipse((i * 71) % size, (i * 97) % size, 22, 7, 0, 0, Math.PI * 2);
      context.fill();
    }
    return this.finishTexture(context);
  }

  private createCanvas(size: number): CanvasRenderingContext2D {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create environment texture context.');
    return context;
  }

  private finishTexture(context: CanvasRenderingContext2D): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(context.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
}
