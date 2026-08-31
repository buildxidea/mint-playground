import * as THREE from 'three';
import {
  POWER_UP_PRESENTATIONS,
  type PowerUpPresentationSpec,
} from './PowerUpCatalog';
import type { PowerUpKind } from './zombiesData';

const templateCache = new Map<PowerUpKind, THREE.Group>();

function material(
  color: string,
  options: { emissive?: boolean; metalness?: number; roughness?: number } = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: options.emissive ? color : '#000000',
    emissiveIntensity: options.emissive ? 0.72 : 0,
    metalness: options.metalness ?? 0.45,
    roughness: options.roughness ?? 0.38,
  });
}

function addMesh(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  meshMaterial: THREE.Material,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, meshMaterial);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function addSharedRewardFrame(
  root: THREE.Group,
  spec: PowerUpPresentationSpec,
): {
  signal: THREE.MeshStandardMaterial;
  pale: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  icon: THREE.Group;
} {
  const signal = material(spec.color, { emissive: true, metalness: 0.32, roughness: 0.3 });
  const pale = material(spec.accent, { emissive: true, metalness: 0.2, roughness: 0.28 });
  const metal = material('#27313c', { metalness: 0.82, roughness: 0.24 });
  const dark = material('#090c10', { metalness: 0.22, roughness: 0.8 });

  const aura = addMesh(
    root,
    'powerup-aura',
    new THREE.TorusGeometry(0.48, 0.025, 6, 32),
    signal,
    [0, -0.34, 0],
    [Math.PI / 2, 0, 0],
  );
  aura.userData.presentationRole = 'idle-aura';

  const contact = addMesh(
    root,
    'powerup-contact-shadow',
    new THREE.CircleGeometry(0.36, 28),
    new THREE.MeshBasicMaterial({
      color: '#05070a',
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
    [0, -0.36, 0],
    [-Math.PI / 2, 0, 0],
  );
  contact.castShadow = false;

  const icon = new THREE.Group();
  icon.name = 'powerup-icon-silhouette';
  root.add(icon);
  return { signal, pale, metal, dark, icon };
}

function buildMaxAmmo(root: THREE.Group, spec: PowerUpPresentationSpec): void {
  const { signal, pale, metal, dark, icon } = addSharedRewardFrame(root, spec);
  addMesh(
    icon,
    'ammo-crate-body',
    new THREE.BoxGeometry(0.58, 0.34, 0.34),
    metal,
    [0, -0.06, 0],
  );
  addMesh(
    icon,
    'ammo-crate-lid',
    new THREE.BoxGeometry(0.62, 0.08, 0.38),
    signal,
    [0, 0.14, 0],
  );
  for (const x of [-0.17, 0.17]) {
    addMesh(
      icon,
      `ammo-magazine-${x < 0 ? 'left' : 'right'}`,
      new THREE.BoxGeometry(0.18, 0.42, 0.16),
      dark,
      [x, 0.22, 0],
      [0, 0, x * 0.5],
    );
    addMesh(
      icon,
      `ammo-round-${x < 0 ? 'left' : 'right'}`,
      new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10),
      pale,
      [x, 0.5, 0],
    );
  }
  for (const x of [-0.25, 0.25]) {
    addMesh(
      icon,
      'ammo-crate-bracket',
      new THREE.BoxGeometry(0.055, 0.34, 0.37),
      signal,
      [x, -0.06, 0],
    );
  }
}

function buildInstaKill(root: THREE.Group, spec: PowerUpPresentationSpec): void {
  const { signal, pale, metal, dark, icon } = addSharedRewardFrame(root, spec);
  for (const direction of [-1, 1]) {
    addMesh(
      icon,
      direction < 0 ? 'insta-blade-left' : 'insta-blade-right',
      new THREE.BoxGeometry(0.07, 0.78, 0.04),
      metal,
      [0, 0, -0.05],
      [0, 0, direction * 0.7],
    );
    addMesh(
      icon,
      'insta-blade-hilt',
      new THREE.BoxGeometry(0.22, 0.06, 0.08),
      signal,
      [direction * 0.2, -0.27, -0.04],
      [0, 0, direction * 0.7],
    );
  }
  addMesh(
    icon,
    'insta-skull-cranium',
    new THREE.SphereGeometry(0.31, 18, 12),
    pale,
    [0, 0.08, 0.08],
    [0, 0, 0],
    [1, 1.05, 0.72],
  );
  addMesh(
    icon,
    'insta-skull-jaw',
    new THREE.BoxGeometry(0.34, 0.22, 0.18),
    pale,
    [0, -0.18, 0.08],
  );
  for (const x of [-0.11, 0.11]) {
    addMesh(
      icon,
      'insta-skull-eye',
      new THREE.SphereGeometry(0.068, 10, 8),
      dark,
      [x, 0.1, 0.29],
      [0, 0, 0],
      [1, 1.18, 0.38],
    );
  }
  addMesh(
    icon,
    'insta-skull-nose',
    new THREE.ConeGeometry(0.045, 0.09, 3),
    dark,
    [0, -0.02, 0.3],
    [0, 0, Math.PI],
  );
}

function addGlyphBar(
  icon: THREE.Group,
  name: string,
  signal: THREE.Material,
  x: number,
  y: number,
  width: number,
  angle = 0,
): void {
  addMesh(
    icon,
    name,
    new THREE.BoxGeometry(width, 0.07, 0.055),
    signal,
    [x, y, 0.245],
    [0, 0, angle],
  );
}

function buildDoublePoints(root: THREE.Group, spec: PowerUpPresentationSpec): void {
  const { signal, pale, metal, icon } = addSharedRewardFrame(root, spec);
  for (const x of [-0.19, 0.19]) {
    addMesh(
      icon,
      x < 0 ? 'points-coin-left' : 'points-coin-right',
      new THREE.CylinderGeometry(0.3, 0.3, 0.1, 12),
      metal,
      [x, 0, 0],
      [Math.PI / 2, 0, 0],
    );
    addMesh(
      icon,
      'points-coin-rim',
      new THREE.TorusGeometry(0.25, 0.035, 6, 20),
      pale,
      [x, 0, 0.075],
    );
  }
  addGlyphBar(icon, 'points-two-top', signal, -0.2, 0.16, 0.23);
  addGlyphBar(icon, 'points-two-upper', signal, -0.14, 0.07, 0.2, -0.72);
  addGlyphBar(icon, 'points-two-middle', signal, -0.2, -0.01, 0.23);
  addGlyphBar(icon, 'points-two-lower', signal, -0.26, -0.1, 0.2, -0.72);
  addGlyphBar(icon, 'points-two-bottom', signal, -0.2, -0.18, 0.23);
  addGlyphBar(icon, 'points-times-a', signal, 0.2, 0, 0.3, 0.78);
  addGlyphBar(icon, 'points-times-b', signal, 0.2, 0, 0.3, -0.78);
}

function buildNuke(root: THREE.Group, spec: PowerUpPresentationSpec): void {
  const { signal, pale, metal, icon } = addSharedRewardFrame(root, spec);
  icon.rotation.z = -0.25;
  addMesh(
    icon,
    'nuke-warhead',
    new THREE.SphereGeometry(0.3, 18, 12),
    pale,
    [-0.05, 0.03, 0],
    [0, 0, 0],
    [1.35, 0.84, 0.84],
  );
  addMesh(
    icon,
    'nuke-tail',
    new THREE.CylinderGeometry(0.14, 0.21, 0.26, 10),
    metal,
    [0.34, 0.03, 0],
    [0, 0, Math.PI / 2],
  );
  for (const rotation of [0, Math.PI / 2]) {
    addMesh(
      icon,
      'nuke-tail-fin',
      new THREE.BoxGeometry(0.28, 0.08, 0.34),
      signal,
      [0.45, 0.03, 0],
      [rotation, 0, 0],
      [1, 1, 0.7],
    );
  }
  const core = new THREE.Group();
  core.name = 'nuke-radiation-core';
  core.position.set(-0.12, 0.03, 0.25);
  icon.add(core);
  for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    addMesh(
      core,
      'nuke-radiation-vane',
      new THREE.BoxGeometry(0.07, 0.18, 0.025),
      signal,
      [Math.cos(angle) * 0.105, Math.sin(angle) * 0.105, 0],
      [0, 0, angle],
    );
  }
}

function buildCarpenter(root: THREE.Group, spec: PowerUpPresentationSpec): void {
  const { signal, pale, metal, icon } = addSharedRewardFrame(root, spec);
  for (const rotation of [-0.62, 0.62]) {
    addMesh(
      icon,
      'carpenter-plank',
      new THREE.BoxGeometry(0.16, 0.82, 0.09),
      signal,
      [0, 0, -0.08],
      [0, 0, rotation],
    );
    for (const y of [-0.22, 0.22]) {
      addMesh(
        icon,
        'carpenter-nail',
        new THREE.CylinderGeometry(0.025, 0.025, 0.04, 8),
        pale,
        [-Math.sin(rotation) * y, Math.cos(rotation) * y, 0.02],
        [Math.PI / 2, 0, 0],
      );
    }
  }
  addMesh(
    icon,
    'carpenter-hammer-handle',
    new THREE.CylinderGeometry(0.045, 0.055, 0.72, 10),
    pale,
    [0.03, -0.02, 0.14],
    [0, 0, -0.72],
  );
  addMesh(
    icon,
    'carpenter-hammer-head',
    new THREE.BoxGeometry(0.38, 0.16, 0.16),
    metal,
    [-0.22, 0.27, 0.14],
    [0, 0, -0.72],
  );
}

function buildTemplate(kind: PowerUpKind): THREE.Group {
  const spec = POWER_UP_PRESENTATIONS[kind];
  const root = new THREE.Group();
  root.name = `powerup-${kind}`;
  root.userData.mintArtifactId = spec.artifactId;
  root.userData.powerUpKind = kind;
  root.userData.powerUpPresentation = {
    version: 1,
    kind,
    silhouette: spec.silhouette,
    iconKey: kind,
    authoredGeometry: true,
  };

  if (kind === 'max-ammo') buildMaxAmmo(root, spec);
  else if (kind === 'insta-kill') buildInstaKill(root, spec);
  else if (kind === 'double-points') buildDoublePoints(root, spec);
  else if (kind === 'nuke') buildNuke(root, spec);
  else buildCarpenter(root, spec);

  root.traverse((object) => {
    object.userData.powerUpKind = kind;
  });
  return root;
}

export function createPowerUpPresentation(kind: PowerUpKind): THREE.Group {
  let template = templateCache.get(kind);
  if (!template) {
    template = buildTemplate(kind);
    templateCache.set(kind, template);
  }
  const instance = template.clone(true);
  instance.name = `powerup-${kind}`;
  return instance;
}
