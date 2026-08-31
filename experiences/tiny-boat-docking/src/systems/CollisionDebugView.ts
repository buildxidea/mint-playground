import * as THREE from 'three';
import type { BoatState, BoatTuning } from './BoatPhysics';
import type { OBB } from './CollisionSystem';

/** Wireframe collider inspection enabled by adding `?debug` to the game URL. */
export class CollisionDebugView {
  private readonly enabled = new URLSearchParams(window.location.search).has('debug');
  private readonly group = new THREE.Group();
  private readonly staticGroup = new THREE.Group();
  private readonly dynamicGroup = new THREE.Group();
  private meshCount = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = 'collision-debug-view';
    this.staticGroup.name = 'static-colliders';
    this.dynamicGroup.name = 'dynamic-colliders';
    this.group.add(this.staticGroup, this.dynamicGroup);
    if (this.enabled) scene.add(this.group);
  }

  setStatic(colliders: readonly OBB[]): void {
    if (!this.enabled) return;
    clearMeshes(this.staticGroup);
    for (const collider of colliders) {
      this.staticGroup.add(createWireframe(collider, colorFor(collider)));
    }
    this.meshCount = this.staticGroup.children.length + this.dynamicGroup.children.length;
  }

  update(player: BoatState, tuning: BoatTuning, moving: readonly OBB[]): void {
    if (!this.enabled) return;
    clearMeshes(this.dynamicGroup);
    this.dynamicGroup.add(
      createWireframe(
        {
          x: player.x,
          z: player.z,
          yaw: player.yaw,
          hx: tuning.hullHalfWidth,
          hz: tuning.hullHalfLength,
          minY: -0.45,
          maxY: 1.95,
          kind: 'boat',
          sourceId: 'player',
        },
        '#ffffff',
      ),
    );
    for (const collider of moving) {
      this.dynamicGroup.add(createWireframe(collider, '#ff9f43'));
    }
    this.meshCount = this.staticGroup.children.length + this.dynamicGroup.children.length;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getMeshCount(): number {
    return this.meshCount;
  }

  dispose(): void {
    clearMeshes(this.staticGroup);
    clearMeshes(this.dynamicGroup);
    this.group.removeFromParent();
  }
}

function createWireframe(collider: OBB, color: THREE.ColorRepresentation): THREE.Mesh {
  const minY = Number.isFinite(collider.minY) ? collider.minY! : 0.02;
  const maxY = Number.isFinite(collider.maxY) ? collider.maxY! : 0.7;
  const height = Math.max(0.08, maxY - minY);
  const geometry = new THREE.BoxGeometry(collider.hx * 2, height, collider.hz * 2);
  const material = new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    transparent: true,
    opacity: collider.kind === 'bound' ? 0.3 : 0.82,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `collider-${collider.sourceId ?? collider.kind}-${collider.partIndex ?? 0}`;
  mesh.position.set(collider.x, minY + height * 0.5, collider.z);
  mesh.rotation.y = collider.yaw;
  mesh.renderOrder = 100;
  return mesh;
}

function colorFor(collider: OBB): THREE.ColorRepresentation {
  if (collider.kind === 'bound') return '#8b98a5';
  if (collider.kind === 'buoy') return '#ffeb3b';
  if (collider.kind === 'boat') return '#ff5d73';
  return '#3dffb5';
}

function clearMeshes(group: THREE.Group): void {
  while (group.children.length) {
    const mesh = group.children[0] as THREE.Mesh;
    group.remove(mesh);
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material.dispose();
  }
}
