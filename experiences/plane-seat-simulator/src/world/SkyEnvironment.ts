import * as THREE from "three";

const SKY_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 topColor;
uniform vec3 bottomColor;
uniform float starIntensity;
varying vec3 vWorldPos;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 dir = normalize(vWorldPos);
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(bottomColor, topColor, pow(h, 0.7));
  if (starIntensity > 0.0 && dir.y > 0.02) {
    vec2 cell = floor(dir.xz / max(dir.y, 0.15) * 60.0);
    float s = hash(cell);
    if (s > 0.985) {
      col += vec3(step(0.995, hash(cell + 7.0)) * 0.5 + 0.5) * starIntensity;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

function makeCloudTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 20 + Math.random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

export interface SkyColors {
  top: number;
  bottom: number;
  cloudTint: number;
  cloudOpacity: number;
  stars: number;
}

/** Gradient sky sphere plus scrolling cloud layers below window level. */
export class SkyEnvironment {
  readonly group = new THREE.Group();
  private skyMat: THREE.ShaderMaterial;
  private cloudMats: THREE.MeshBasicMaterial[] = [];
  private cloudTextures: THREE.CanvasTexture[] = [];

  constructor() {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        topColor: { value: new THREE.Color(0x2f6fd0) },
        bottomColor: { value: new THREE.Color(0xcfe4f5) },
        starIntensity: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), this.skyMat);
    this.group.add(sky);

    const layers: Array<{ y: number; size: number; opacity: number; speed: number }> = [
      { y: -8, size: 260, opacity: 0.9, speed: 0.004 },
      { y: -16, size: 320, opacity: 0.6, speed: 0.0022 },
    ];
    for (const layer of layers) {
      const tex = makeCloudTexture();
      this.cloudTextures.push(tex);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: layer.opacity,
        depthWrite: false,
      });
      this.cloudMats.push(mat);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(layer.size, layer.size), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = layer.y;
      plane.userData.scrollSpeed = layer.speed;
      this.group.add(plane);
    }
  }

  applyColors(colors: SkyColors) {
    (this.skyMat.uniforms.topColor.value as THREE.Color).setHex(colors.top);
    (this.skyMat.uniforms.bottomColor.value as THREE.Color).setHex(colors.bottom);
    this.skyMat.uniforms.starIntensity.value = colors.stars;
    this.cloudMats.forEach((mat, i) => {
      mat.color.setHex(colors.cloudTint);
      mat.opacity = colors.cloudOpacity * (i === 0 ? 1 : 0.65);
    });
  }

  update(dt: number) {
    for (const tex of this.cloudTextures) {
      tex.offset.x += dt * 0.01;
    }
    this.group.children.forEach((child) => {
      const speed = child.userData.scrollSpeed as number | undefined;
      if (speed) child.position.x = ((child.position.x + speed) % 40 + 40) % 40 - 20;
    });
  }
}
