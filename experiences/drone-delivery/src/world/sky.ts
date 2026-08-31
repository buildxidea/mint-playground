import * as THREE from 'three';

/**
 * Bright miniature-city sky: a vertical pastel gradient dome plus scene fog
 * that fades the ground plane into the horizon color.
 */
export function createSky(scene: THREE.Scene): { dispose(): void } {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create sky texture context.');
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#69b7ff');
  gradient.addColorStop(0.55, '#a7d8ff');
  gradient.addColorStop(0.82, '#eaf6ff');
  gradient.addColorStop(1, '#fdf3e3');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.SphereGeometry(220, 24, 16);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(geometry, material);
  dome.name = 'sky-dome';
  scene.add(dome);

  scene.fog = new THREE.Fog('#dcefff', 90, 210);

  const hemisphere = new THREE.HemisphereLight('#eaf4ff', '#b8d8b8', 1.15);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight('#fff4d6', 2.2);
  sun.position.set(-40, 70, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 180;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  return {
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
      scene.remove(dome, hemisphere, sun);
    },
  };
}

/**
 * Dashed guide line from the drone to the current objective, plus a soft
 * vertical beacon over the target pad, so the flight path stays readable.
 */
export class FlightGuide {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.LineDashedMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.75,
    dashSize: 1.4,
    gapSize: 0.9,
  });
  private readonly line: THREE.Line;
  private readonly beaconGeometry = new THREE.CylinderGeometry(0.35, 0.35, 30, 12, 1, true);
  private readonly beaconMaterial = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly beacon: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    scene.add(this.line);
    this.beacon = new THREE.Mesh(this.beaconGeometry, this.beaconMaterial);
    scene.add(this.beacon);
  }

  setTarget(color: THREE.Color): void {
    this.material.color.copy(color);
    this.beaconMaterial.color.copy(color);
  }

  update(from: THREE.Vector3, to: THREE.Vector3 | null): void {
    const visible = Boolean(to);
    this.line.visible = visible;
    this.beacon.visible = visible;
    if (!to) return;
    this.geometry.setFromPoints([from.clone(), to.clone().add(new THREE.Vector3(0, 0.4, 0))]);
    this.line.computeLineDistances();
    this.beacon.position.set(to.x, to.y + 15, to.z);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.beaconGeometry.dispose();
    this.beaconMaterial.dispose();
  }
}
