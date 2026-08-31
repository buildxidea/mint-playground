import * as THREE from 'three';
import { CORRIDOR } from '../config';

const WATER_COLOR = new THREE.Color('#1173a8');
const DEEP_COLOR = new THREE.Color('#0b4f7e');

function createWaterEnvironmentTexture(): THREE.CanvasTexture {
  const width = 128;
  const height = 64;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create environment texture context.');

  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#eafcff'); // shimmering surface overhead
  gradient.addColorStop(0.35, '#5fc4ef');
  gradient.addColorStop(0.65, '#1173a8');
  gradient.addColorStop(1, '#083a5e'); // deep water below
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  // A few bright surface streaks so reflections have shape, not just tone.
  context.fillStyle = 'rgba(255, 255, 255, 0.55)';
  for (let i = 0; i < 7; i += 1) {
    const x = (i / 7) * width + 4;
    context.fillRect(x, 3 + (i % 3) * 2, 9 + (i % 4) * 4, 2.5);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

function createCausticsTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create caustics texture context.');

  context.fillStyle = '#d8c9a0';
  context.fillRect(0, 0, size, size);
  // Web of brighter ripple lines over the sand.
  context.strokeStyle = 'rgba(255, 250, 224, 0.5)';
  context.lineWidth = 2.4;
  for (let i = 0; i < 26; i += 1) {
    context.beginPath();
    const y0 = (i / 26) * size;
    context.moveTo(0, y0);
    for (let x = 0; x <= size; x += 16) {
      context.lineTo(x, y0 + Math.sin((x / size) * Math.PI * 4 + i * 1.7) * 9);
    }
    context.stroke();
  }
  context.strokeStyle = 'rgba(150, 128, 88, 0.35)';
  context.lineWidth = 1.6;
  for (let i = 0; i < 26; i += 1) {
    context.beginPath();
    const x0 = (i / 26) * size;
    context.moveTo(x0, 0);
    for (let y = 0; y <= size; y += 16) {
      context.lineTo(x0 + Math.sin((y / size) * Math.PI * 4 + i * 2.3) * 9, y);
    }
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Stylized ocean: gradient fog water, animated god-ray shafts from the
 * surface, a sandy caustic seabed that follows the player, and drifting
 * particulate motes. Everything here recenters on the fish every frame so the
 * endless run never leaves the dressed volume.
 */
export class Environment {
  readonly group = new THREE.Group();

  private readonly seabed: THREE.Mesh;
  private readonly seabedTexture = createCausticsTexture();
  private readonly motes: THREE.Points;
  private readonly motePositions: Float32Array;

  constructor(scene: THREE.Scene, private readonly rng: () => number) {
    scene.background = WATER_COLOR.clone();
    scene.fog = new THREE.Fog(WATER_COLOR.clone().lerp(DEEP_COLOR, 0.4), 26, 120);

    // Equirect environment map gives glass/gloss materials reflections
    // (bubble rings, fish sheen): bright water surface above, deep blue below.
    scene.environment = createWaterEnvironmentTexture();
    scene.environmentIntensity = 0.6;

    const hemisphere = new THREE.HemisphereLight('#bfe9ff', '#0c3a5c', 1.35);
    this.group.add(hemisphere);
    const sun = new THREE.DirectionalLight('#eaf7ff', 2.0);
    sun.position.set(6, 30, -8);
    this.group.add(sun);
    const fill = new THREE.DirectionalLight('#7fd0ff', 0.5);
    fill.position.set(-8, 10, 6);
    this.group.add(fill);

    // Seabed.
    this.seabedTexture.repeat.set(24, 24);
    this.seabed = new THREE.Mesh(
      new THREE.PlaneGeometry(360, 360, 1, 1),
      new THREE.MeshStandardMaterial({ map: this.seabedTexture, color: '#e8ddb8', roughness: 0.95 }),
    );
    this.seabed.rotation.x = -Math.PI / 2;
    this.seabed.position.y = CORRIDOR.seabedY;
    this.group.add(this.seabed);

    // Particulate motes.
    const moteCount = 340;
    this.motePositions = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i += 1) {
      this.motePositions[i * 3] = (this.rng() - 0.5) * 90;
      this.motePositions[i * 3 + 1] = this.rng() * 32;
      this.motePositions[i * 3 + 2] = (this.rng() - 0.5) * 140;
    }
    const moteGeometry = new THREE.BufferGeometry();
    moteGeometry.setAttribute('position', new THREE.BufferAttribute(this.motePositions, 3));
    this.motes = new THREE.Points(
      moteGeometry,
      new THREE.PointsMaterial({
        color: '#cfeaff',
        size: 0.14,
        transparent: true,
        opacity: 0.55,
        sizeAttenuation: true,
        depthWrite: false,
      }),
    );
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
  }

  update(elapsed: number, playerZ: number, playerX: number): void {
    this.seabed.position.z = playerZ - 100;
    this.seabed.position.x = playerX;
    this.seabedTexture.offset.set(playerX / 15, -(playerZ - 100) / 15);

    // Wrap motes around the player volume.
    const geometry = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < geometry.count; i += 1) {
      let z = this.motePositions[i * 3 + 2];
      const relative = z - playerZ;
      if (relative > 30) z -= 140;
      else if (relative < -110) z += 140;
      this.motePositions[i * 3 + 2] = z;
      this.motePositions[i * 3 + 1] += Math.sin(elapsed * 0.6 + i) * 0.002;
    }
    geometry.needsUpdate = true;
  }

  dispose(): void {
    this.seabedTexture.dispose();
  }
}
