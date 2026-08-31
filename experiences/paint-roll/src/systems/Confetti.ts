import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Points,
  PointsMaterial,
  type Vector3,
} from 'three';

const MAX_PARTICLES = 320;
const GRAVITY = -6.2;
const LIFETIME = 2.6;

function splatTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

/** Paint-splat burst for the completion reveal. */
export class Confetti {
  readonly points: Points;

  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly colors = new Float32Array(MAX_PARTICLES * 3);
  private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
  private readonly lives = new Float32Array(MAX_PARTICLES);
  private active = 0;

  constructor() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    geometry.setDrawRange(0, 0);

    const material = new PointsMaterial({
      size: 0.17,
      sizeAttenuation: true,
      vertexColors: true,
      map: splatTexture(),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  burst(origin: Vector3, spreadX: number, spreadY: number, palette: readonly Color[]): void {
    this.active = MAX_PARTICLES;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      const o = i * 3;
      this.positions[o] = origin.x + (Math.random() - 0.5) * spreadX;
      this.positions[o + 1] = origin.y + (Math.random() - 0.5) * spreadY;
      this.positions[o + 2] = origin.z + Math.random() * 0.6;

      const speed = 2.6 + Math.random() * 4.4;
      const angle = Math.random() * Math.PI * 2;
      this.velocities[o] = Math.cos(angle) * speed * 0.55;
      this.velocities[o + 1] = 2.2 + Math.random() * speed;
      this.velocities[o + 2] = Math.sin(angle) * speed * 0.3 + 0.7;

      const color = palette[Math.floor(Math.random() * palette.length)];
      this.colors[o] = color.r;
      this.colors[o + 1] = color.g;
      this.colors[o + 2] = color.b;

      this.lives[i] = LIFETIME * (0.6 + Math.random() * 0.4);
    }
    this.points.visible = true;
    this.points.geometry.setDrawRange(0, MAX_PARTICLES);
  }

  update(deltaSeconds: number): void {
    if (this.active === 0) return;

    let alive = 0;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (this.lives[i] <= 0) continue;
      this.lives[i] -= deltaSeconds;
      alive += 1;

      const o = i * 3;
      this.velocities[o + 1] += GRAVITY * deltaSeconds;
      this.positions[o] += this.velocities[o] * deltaSeconds;
      this.positions[o + 1] += this.velocities[o + 1] * deltaSeconds;
      this.positions[o + 2] += this.velocities[o + 2] * deltaSeconds;

      // Fade by dimming the vertex colour; cheaper than a per-point alpha.
      const fade = Math.max(0, Math.min(1, this.lives[i] / 0.7));
      this.colors[o] *= fade < 1 ? 0.94 : 1;
      this.colors[o + 1] *= fade < 1 ? 0.94 : 1;
      this.colors[o + 2] *= fade < 1 ? 0.94 : 1;
    }

    this.active = alive;
    if (alive === 0) {
      this.points.visible = false;
      this.points.geometry.setDrawRange(0, 0);
      return;
    }

    (this.points.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  reset(): void {
    this.active = 0;
    this.lives.fill(0);
    this.points.visible = false;
    this.points.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as PointsMaterial).map?.dispose();
    (this.points.material as PointsMaterial).dispose();
  }
}
