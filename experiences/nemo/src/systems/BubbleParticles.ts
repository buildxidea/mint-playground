import * as THREE from 'three';

const MAX_PARTICLES = 900;

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aLife;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (340.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying float vLife;
  void main() {
    if (vLife <= 0.0) discard;
    vec4 tex = texture2D(uMap, gl_PointCoord);
    float fade = smoothstep(0.0, 0.15, vLife) * smoothstep(1.0, 0.75, vLife);
    gl_FragColor = vec4(tex.rgb, tex.a * fade);
  }
`;

function createBubbleSprite(): THREE.CanvasTexture {
  const size = 128;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create bubble sprite context.');

  // See-through interior with a faint cool tint that thickens toward the edge.
  const fill = context.createRadialGradient(half, half, size * 0.05, half, half, size * 0.46);
  fill.addColorStop(0, 'rgba(215, 242, 255, 0.05)');
  fill.addColorStop(0.6, 'rgba(205, 238, 255, 0.09)');
  fill.addColorStop(0.85, 'rgba(215, 244, 255, 0.22)');
  fill.addColorStop(1, 'rgba(230, 250, 255, 0)');
  context.fillStyle = fill;
  context.beginPath();
  context.arc(half, half, size * 0.46, 0, Math.PI * 2);
  context.fill();

  // Thin bright rim — the soap-film edge that reads as "bubble".
  context.lineWidth = size * 0.05;
  context.strokeStyle = 'rgba(240, 252, 255, 0.95)';
  context.beginPath();
  context.arc(half, half, size * 0.42, 0, Math.PI * 2);
  context.stroke();

  // Softer secondary reflection arc, lower-right interior.
  context.lineWidth = size * 0.035;
  context.strokeStyle = 'rgba(200, 236, 255, 0.4)';
  context.beginPath();
  context.arc(half, half, size * 0.3, Math.PI * 0.15, Math.PI * 0.6);
  context.stroke();

  // Specular glint, upper-left.
  context.fillStyle = 'rgba(255, 255, 255, 0.95)';
  context.beginPath();
  context.ellipse(size * 0.34, size * 0.3, size * 0.1, size * 0.06, -0.65, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = 'rgba(255, 255, 255, 0.7)';
  context.beginPath();
  context.arc(size * 0.62, size * 0.68, size * 0.035, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * One pooled point-sprite system for every bubble effect: the fish's speed
 * trail, ring-pass bursts, and jelly-bounce puffs. Bubbles rise with a wobble,
 * grow slightly, and pop (fade) at end of life.
 */
export class BubbleParticles {
  readonly points: THREE.Points;

  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
  private readonly sizes = new Float32Array(MAX_PARTICLES);
  private readonly lives = new Float32Array(MAX_PARTICLES);
  private readonly maxLives = new Float32Array(MAX_PARTICLES);
  private readonly wobblePhases = new Float32Array(MAX_PARTICLES);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly texture = createBubbleSprite();
  private cursor = 0;

  constructor(private readonly rng: () => number) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lives, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.texture } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  emit(
    origin: THREE.Vector3,
    count: number,
    options: { spread?: number; speed?: number; size?: number; life?: number; upward?: number } = {},
  ): void {
    const spread = options.spread ?? 0.25;
    const speed = options.speed ?? 0.6;
    const baseSize = options.size ?? 0.75;
    const life = options.life ?? 2.2;
    const upward = options.upward ?? 0.8;

    for (let i = 0; i < count; i += 1) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const offset = index * 3;
      this.positions[offset] = origin.x + (this.rng() - 0.5) * spread * 2;
      this.positions[offset + 1] = origin.y + (this.rng() - 0.5) * spread * 2;
      this.positions[offset + 2] = origin.z + (this.rng() - 0.5) * spread * 2;
      this.velocities[offset] = (this.rng() - 0.5) * speed;
      this.velocities[offset + 1] = upward * (0.5 + this.rng());
      this.velocities[offset + 2] = (this.rng() - 0.5) * speed;
      const lifetime = life * (0.6 + this.rng() * 0.8);
      this.lives[index] = lifetime;
      this.maxLives[index] = lifetime;
      this.sizes[index] = baseSize * (0.5 + this.rng());
      this.wobblePhases[index] = this.rng() * Math.PI * 2;
    }
  }

  update(delta: number, elapsed: number): void {
    const lifeAttribute = this.geometry.getAttribute('aLife') as THREE.BufferAttribute;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (this.maxLives[i] <= 0) continue;
      this.lives[i] -= delta;
      const offset = i * 3;
      if (this.lives[i] <= 0) {
        this.maxLives[i] = 0;
        this.lives[i] = 0;
      } else {
        const wobble = Math.sin(elapsed * 5 + this.wobblePhases[i]) * 0.35;
        this.positions[offset] += (this.velocities[offset] + wobble * 0.4) * delta;
        this.positions[offset + 1] += this.velocities[offset + 1] * delta;
        this.positions[offset + 2] += this.velocities[offset + 2] * delta;
        this.velocities[offset + 1] += delta * 0.55; // buoyancy
        this.sizes[i] += delta * 0.16; // bubbles expand as they rise
      }
      lifeAttribute.setX(i, this.maxLives[i] > 0 ? this.lives[i] / this.maxLives[i] : 0);
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    lifeAttribute.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
