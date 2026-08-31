/**
 * Sky dome, starfield, and celestial body for THE MARS TRAIL.
 *
 * The reference art builds every frame on a vertical sky gradient that sets the
 * whole scene's colour temperature. This reproduces that as an unlit gradient
 * plane behind everything, with a star layer and an optional planet disc.
 */

import * as THREE from 'three';
import type { ScenePalette } from './palettes';

const GradientShader = {
  uniforms: {
    uTop: { value: new THREE.Color('#0a1a3c') },
    uMid: { value: new THREE.Color('#1d4f8a') },
    uBottom: { value: new THREE.Color('#5ba3c9') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uTop;
    uniform vec3 uMid;
    uniform vec3 uBottom;
    varying vec2 vUv;

    void main() {
      // Two-stop gradient with the midpoint pulled low, which is what gives the
      // reference skies their heavy band of colour near the horizon.
      float t = vUv.y;
      vec3 color = t < 0.55
        ? mix(uBottom, uMid, smoothstep(0.0, 0.55, t))
        : mix(uMid, uTop, smoothstep(0.55, 1.0, t));
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export class Backdrop {
  readonly group = new THREE.Group();

  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly stars: THREE.Points;
  private readonly starMaterial: THREE.PointsMaterial;
  private readonly bodyGroup = new THREE.Group();
  private readonly bodyMaterial: THREE.MeshBasicMaterial;
  private readonly bodyRimMaterial: THREE.MeshBasicMaterial;
  private readonly bodyMesh: THREE.Mesh;
  private readonly bodyRim: THREE.Mesh;

  constructor(rng: () => number) {
    // The sky sits at the far plane and is deliberately unlit; lighting it would
    // fight the posterisation pass for control of the frame's value range.
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(GradientShader.uniforms),
      vertexShader: GradientShader.vertexShader,
      fragmentShader: GradientShader.fragmentShader,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });

    const sky = new THREE.Mesh(new THREE.PlaneGeometry(400, 220), this.skyMaterial);
    sky.position.set(0, 0, -160);
    sky.renderOrder = -100;
    this.group.add(sky);

    // Starfield.
    const starCount = 900;
    const positions = new Float32Array(starCount * 3);
    const scales = new Float32Array(starCount);
    for (let i = 0; i < starCount; i += 1) {
      positions[i * 3] = (rng() - 0.5) * 340;
      positions[i * 3 + 1] = (rng() - 0.5) * 190;
      positions[i * 3 + 2] = -150 + rng() * 40;
      scales[i] = 0.4 + rng() * 1.2;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

    this.starMaterial = new THREE.PointsMaterial({
      color: '#ffffff',
      size: 0.9,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(starGeometry, this.starMaterial);
    this.stars.renderOrder = -99;
    this.group.add(this.stars);

    // Celestial body: a flat disc plus a slightly larger rim disc behind it, so
    // the limb reads as a hard pixel edge instead of a soft sphere.
    this.bodyRimMaterial = new THREE.MeshBasicMaterial({
      color: '#9fd4f0',
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: false,
    });
    this.bodyMaterial = new THREE.MeshBasicMaterial({
      color: '#2f7bb5',
      depthWrite: false,
      fog: false,
    });

    this.bodyRim = new THREE.Mesh(new THREE.CircleGeometry(1, 48), this.bodyRimMaterial);
    this.bodyMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 48), this.bodyMaterial);
    this.bodyRim.position.z = -0.1;
    this.bodyGroup.add(this.bodyRim);
    this.bodyGroup.add(this.bodyMesh);
    this.bodyGroup.position.z = -140;
    this.bodyGroup.renderOrder = -98;
    this.bodyGroup.visible = false;
    this.group.add(this.bodyGroup);
  }

  applyPalette(palette: ScenePalette): void {
    this.skyMaterial.uniforms.uTop.value.set(palette.skyTop);
    this.skyMaterial.uniforms.uMid.value.set(palette.skyMid);
    this.skyMaterial.uniforms.uBottom.value.set(palette.skyBottom);

    this.starMaterial.opacity = 0.15 + palette.starDensity * 0.8;
    this.stars.visible = palette.starDensity > 0.02;

    if (palette.body) {
      this.bodyGroup.visible = true;
      this.bodyMaterial.color.set(palette.body.color);
      this.bodyRimMaterial.color.set(palette.body.rimColor);
      this.bodyGroup.position.x = palette.body.position[0] * 4;
      this.bodyGroup.position.y = palette.body.position[1] * 4;
      this.bodyMesh.scale.setScalar(palette.body.radius * 3.2);
      this.bodyRim.scale.setScalar(palette.body.radius * 3.45);
    } else {
      this.bodyGroup.visible = false;
    }
  }

  /** Stars drift very slowly so the deep legs still feel like motion. */
  update(delta: number, travelRate: number): void {
    this.stars.position.x += delta * travelRate * 0.15;
    if (this.stars.position.x > 170) this.stars.position.x -= 170;
  }

  dispose(): void {
    this.skyMaterial.dispose();
    this.starMaterial.dispose();
    this.stars.geometry.dispose();
    this.bodyMaterial.dispose();
    this.bodyRimMaterial.dispose();
    this.bodyMesh.geometry.dispose();
    this.bodyRim.geometry.dispose();
  }
}
