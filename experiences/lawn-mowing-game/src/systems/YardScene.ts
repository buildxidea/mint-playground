import * as THREE from 'three';
import type { Level, Obstacle, ObstacleKind } from '../game/levels';
import type { YardGeometry } from './YardGeometry';

/**
 * Everything in the yard that is not grass: the soil slab the diorama sits on,
 * the props, and their contact shadows.
 *
 * Props start as gray-box primitives. {@link setPropModel} swaps in a generated
 * model per kind once one has been approved, so gameplay never waits on art.
 */
export class YardScene {
  readonly group = new THREE.Group();

  private readonly propRoots = new Map<ObstacleKind, THREE.Group[]>();
  private readonly placeholders = new Map<THREE.Group, THREE.Object3D>();
  private readonly obstacleByRoot = new Map<THREE.Group, Obstacle>();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private readonly shadowTexture: THREE.Texture;

  constructor(level: Level, yard: YardGeometry) {
    this.shadowTexture = this.createShadowTexture();

    this.group.add(this.createTable(yard));

    for (const rect of level.yard) {
      const soil = this.track(new THREE.BoxGeometry(rect.w, 0.55, rect.d));
      const soilMaterial = this.track(
        new THREE.MeshStandardMaterial({ color: '#4a3625', roughness: 0.95 }),
      );
      const soilMesh = new THREE.Mesh(soil, soilMaterial);
      soilMesh.position.set(rect.x, -0.275, rect.z);
      soilMesh.receiveShadow = true;
      this.group.add(soilMesh);
    }

    for (const obstacle of level.obstacles) {
      const root = new THREE.Group();
      root.position.set(obstacle.x, 0, obstacle.z);
      const placeholder = this.createPlaceholder(obstacle);
      root.add(placeholder);
      this.placeholders.set(root, placeholder);
      this.obstacleByRoot.set(root, obstacle);

      const shadow = this.createContactShadow(obstacle);
      if (shadow) root.add(shadow);

      const existing = this.propRoots.get(obstacle.kind) ?? [];
      existing.push(root);
      this.propRoots.set(obstacle.kind, existing);
      this.group.add(root);
    }
  }

  /** Replace every placeholder of one kind with an approved generated model. */
  setPropModel(kind: ObstacleKind, model: THREE.Object3D): void {
    const roots = this.propRoots.get(kind);
    if (!roots) return;

    for (const root of roots) {
      const obstacle = this.obstacleByRoot.get(root);
      if (!obstacle) continue;

      const fitted =
        kind === 'fence' ? this.fitFenceRun(model, obstacle) : this.fitSingle(model, obstacle, kind);

      fitted.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) child.castShadow = true;
      });

      const placeholder = this.placeholders.get(root);
      if (placeholder) {
        root.remove(placeholder);
        this.placeholders.delete(root);
      }
      root.add(fitted);
    }
  }

  /** Scale one model to the obstacle's authored footprint and sit it on the turf. */
  private fitSingle(
    model: THREE.Object3D,
    obstacle: Obstacle,
    kind: ObstacleKind,
  ): THREE.Object3D {
    const instance = model.clone(true);
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(instance).getSize(size);

    let scale: number;
    if (obstacle.shape === 'circle') {
      scale = (obstacle.r * 2) / Math.max(1e-3, Math.max(size.x, size.z));
    } else {
      // Beds and slabs fit inside their rectangle rather than spanning its
      // longest side, so a wide bed never spills onto mowable grass.
      scale = Math.min(obstacle.w / Math.max(1e-3, size.x), obstacle.d / Math.max(1e-3, size.z));
    }
    instance.scale.setScalar(scale);

    const scaledBox = new THREE.Box3().setFromObject(instance);
    instance.position.y -= scaledBox.min.y;

    // Deterministic per-position variation so repeated props are not clones.
    if (kind === 'tree' || kind === 'gnome') {
      const seed = Math.abs(Math.sin(obstacle.x * 12.9898 + obstacle.z * 78.233) * 43758.5453) % 1;
      instance.rotation.y = seed * Math.PI * 2;
    }

    return instance;
  }

  /**
   * A fence is one section repeated along the run. Scaling a single section to
   * the full length would stretch it into a wall.
   */
  private fitFenceRun(model: THREE.Object3D, obstacle: Obstacle): THREE.Object3D {
    const group = new THREE.Group();
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(model).getSize(size);

    const targetHeight = 1.1;
    const scale = targetHeight / Math.max(1e-3, size.y);
    const sectionLength = Math.max(0.6, size.x * scale);

    const runLength = obstacle.shape === 'rect' ? Math.max(obstacle.w, obstacle.d) : 4;
    const alongZ = obstacle.shape === 'rect' && obstacle.d > obstacle.w;
    const sections = Math.max(1, Math.round(runLength / sectionLength));
    const spacing = runLength / sections;

    for (let i = 0; i < sections; i += 1) {
      const instance = model.clone(true);
      instance.scale.setScalar(scale);
      const scaledBox = new THREE.Box3().setFromObject(instance);
      instance.position.y = -scaledBox.min.y;

      const offset = -runLength / 2 + spacing * (i + 0.5);
      if (alongZ) {
        instance.position.z = offset;
        instance.rotation.y = Math.PI / 2;
      } else {
        instance.position.x = offset;
      }
      group.add(instance);
    }

    return group;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  private createTable(yard: YardGeometry): THREE.Mesh {
    const bounds = yard.maskBounds;
    const geometry = this.track(
      new THREE.PlaneGeometry(bounds.width * 2.6, bounds.depth * 2.6),
    );
    const material = this.track(
      new THREE.MeshStandardMaterial({ color: '#e5decf', roughness: 1 }),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(bounds.centerX, -0.55, bounds.centerZ);
    mesh.receiveShadow = true;
    return mesh;
  }

  private createPlaceholder(obstacle: Obstacle): THREE.Object3D {
    const group = new THREE.Group();

    switch (obstacle.kind) {
      case 'tree': {
        const radius = obstacle.shape === 'circle' ? obstacle.r : 1.2;
        const trunk = this.track(new THREE.CylinderGeometry(0.18, 0.24, 1.3, 10));
        const trunkMaterial = this.track(
          new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.9 }),
        );
        const trunkMesh = new THREE.Mesh(trunk, trunkMaterial);
        trunkMesh.position.y = 0.65;
        trunkMesh.castShadow = true;
        group.add(trunkMesh);

        const canopy = this.track(new THREE.SphereGeometry(radius * 0.95, 16, 12));
        const canopyMaterial = this.track(
          new THREE.MeshStandardMaterial({ color: '#3f7a34', roughness: 0.85 }),
        );
        const canopyMesh = new THREE.Mesh(canopy, canopyMaterial);
        canopyMesh.position.y = 1.3 + radius * 0.6;
        canopyMesh.scale.y = 0.82;
        canopyMesh.castShadow = true;
        group.add(canopyMesh);
        break;
      }
      case 'bush': {
        const w = obstacle.shape === 'rect' ? obstacle.w : 2;
        const d = obstacle.shape === 'rect' ? obstacle.d : 2;
        const bed = this.track(new THREE.BoxGeometry(w, 0.3, d));
        const bedMaterial = this.track(
          new THREE.MeshStandardMaterial({ color: '#5b3f2c', roughness: 0.95 }),
        );
        const bedMesh = new THREE.Mesh(bed, bedMaterial);
        bedMesh.position.y = 0.15;
        bedMesh.receiveShadow = true;
        group.add(bedMesh);

        const flowerGeometry = this.track(new THREE.SphereGeometry(0.28, 10, 8));
        const flowerMaterials = [
          this.track(new THREE.MeshStandardMaterial({ color: '#d9527f', roughness: 0.7 })),
          this.track(new THREE.MeshStandardMaterial({ color: '#e8b23c', roughness: 0.7 })),
          this.track(new THREE.MeshStandardMaterial({ color: '#c34d3c', roughness: 0.7 })),
        ];
        let index = 0;
        for (let fx = -w / 2 + 0.4; fx < w / 2 - 0.2; fx += 0.62) {
          for (let fz = -d / 2 + 0.4; fz < d / 2 - 0.2; fz += 0.62) {
            const flower = new THREE.Mesh(flowerGeometry, flowerMaterials[index % 3]);
            flower.position.set(fx, 0.42, fz);
            flower.castShadow = true;
            group.add(flower);
            index += 1;
          }
        }
        break;
      }
      case 'gnome': {
        const body = this.track(new THREE.ConeGeometry(0.3, 0.62, 10));
        const bodyMaterial = this.track(
          new THREE.MeshStandardMaterial({ color: '#3f6fb5', roughness: 0.75 }),
        );
        const bodyMesh = new THREE.Mesh(body, bodyMaterial);
        bodyMesh.position.y = 0.31;
        bodyMesh.castShadow = true;
        group.add(bodyMesh);

        const hat = this.track(new THREE.ConeGeometry(0.2, 0.42, 10));
        const hatMaterial = this.track(
          new THREE.MeshStandardMaterial({ color: '#c8422f', roughness: 0.7 }),
        );
        const hatMesh = new THREE.Mesh(hat, hatMaterial);
        hatMesh.position.y = 0.78;
        hatMesh.castShadow = true;
        group.add(hatMesh);
        break;
      }
      case 'fence': {
        const w = obstacle.shape === 'rect' ? obstacle.w : 4;
        const d = obstacle.shape === 'rect' ? obstacle.d : 0.4;
        const railGeometry = this.track(new THREE.BoxGeometry(w, 0.12, d * 0.5));
        const postGeometry = this.track(new THREE.BoxGeometry(d * 0.9, 1.05, d * 0.9));
        const material = this.track(
          new THREE.MeshStandardMaterial({ color: '#d8cdb6', roughness: 0.85 }),
        );
        for (const y of [0.45, 0.78]) {
          const rail = new THREE.Mesh(railGeometry, material);
          rail.position.y = y;
          rail.castShadow = true;
          group.add(rail);
        }
        for (let x = -w / 2; x <= w / 2 + 0.01; x += Math.max(1.2, w / 6)) {
          const post = new THREE.Mesh(postGeometry, material);
          post.position.set(x, 0.52, 0);
          post.castShadow = true;
          group.add(post);
        }
        break;
      }
      case 'patio': {
        const w = obstacle.shape === 'rect' ? obstacle.w : 4;
        const d = obstacle.shape === 'rect' ? obstacle.d : 4;
        const slab = this.track(new THREE.BoxGeometry(w, 0.12, d));
        const material = this.track(
          new THREE.MeshStandardMaterial({ color: '#b9ac96', roughness: 0.9 }),
        );
        const mesh = new THREE.Mesh(slab, material);
        mesh.position.y = 0.06;
        mesh.receiveShadow = true;
        group.add(mesh);
        break;
      }
      case 'pool': {
        const radius = obstacle.shape === 'circle' ? obstacle.r : 2;
        const rim = this.track(new THREE.CylinderGeometry(radius, radius, 0.22, 28));
        const rimMaterial = this.track(
          new THREE.MeshStandardMaterial({ color: '#cfd4d8', roughness: 0.6 }),
        );
        const rimMesh = new THREE.Mesh(rim, rimMaterial);
        rimMesh.position.y = 0.11;
        rimMesh.receiveShadow = true;
        group.add(rimMesh);

        const water = this.track(new THREE.CircleGeometry(radius * 0.88, 28));
        const waterMaterial = this.track(
          new THREE.MeshStandardMaterial({
            color: '#3f9ec4',
            roughness: 0.18,
            metalness: 0.1,
          }),
        );
        const waterMesh = new THREE.Mesh(water, waterMaterial);
        waterMesh.rotation.x = -Math.PI / 2;
        waterMesh.position.y = 0.23;
        group.add(waterMesh);
        break;
      }
    }

    return group;
  }

  private createContactShadow(obstacle: Obstacle): THREE.Mesh | null {
    if (obstacle.kind === 'patio' || obstacle.kind === 'pool') return null;

    const size =
      obstacle.shape === 'circle'
        ? obstacle.r * 2.4
        : Math.max(obstacle.w, obstacle.d) * 1.5;
    const geometry = this.track(new THREE.PlaneGeometry(size, size));
    const material = this.track(
      new THREE.MeshBasicMaterial({
        map: this.shadowTexture,
        transparent: true,
        opacity: 0.3,
        color: '#1d2416',
        depthWrite: false,
      }),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0.28, 0.012, 0.28);
    mesh.renderOrder = 1;
    return mesh;
  }

  private createShadowTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the contact shadow texture.');

    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    this.disposables.push(texture);
    return texture;
  }

  private track<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(item: T): T {
    this.disposables.push(item);
    return item;
  }
}
