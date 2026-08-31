import * as THREE from 'three';
import type { LevelDef } from './LevelDef';
import { cloneModel, type LoadedModel } from '../assets/loadModels';
import type { ModelAssetId } from '../assets/registry';
import { liftAboveWater } from './grounding';

export type SlipMarker = {
  group: THREE.Group;
  pad: THREE.Mesh;
  pulse: THREE.Mesh;
};

/** Surface-level slip target — pad, pulse, rails, and approach chevrons only. */
export function createSlipMarker(
  level: LevelDef,
  models: Map<ModelAssetId, LoadedModel>,
): SlipMarker {
  const { slip } = level;
  const group = new THREE.Group();
  group.name = 'slip-marker';
  group.position.set(slip.x, 0, slip.z);
  group.rotation.y = slip.yaw;

  const width = slip.halfWidth * 2;
  const length = slip.halfLength * 2;

  // Bright floor pad — above water, no depth fight with the sea plane.
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.05, length * 1.05),
    new THREE.MeshStandardMaterial({
      color: '#5dff9a',
      emissive: '#22ff7a',
      emissiveIntensity: 2.4,
      transparent: true,
      opacity: 0.88,
      roughness: 0.3,
      metalness: 0.05,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.22;
  pad.name = 'slip-highlight';
  pad.renderOrder = 20;
  pad.userData.procedural = true;
  group.add(pad);

  // Outer pulse ring.
  const pulse = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(width, length) * 0.58, Math.max(width, length) * 0.82, 48),
    new THREE.MeshBasicMaterial({
      color: '#b8ffe0',
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  pulse.rotation.x = -Math.PI / 2;
  pulse.position.y = 0.24;
  pulse.renderOrder = 21;
  pulse.userData.procedural = true;
  group.add(pulse);

  // Side rails so the berth reads as a parking bay.
  const railMat = new THREE.MeshStandardMaterial({
    color: '#f4ff7a',
    emissive: '#d6ff2a',
    emissiveIntensity: 1.4,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const railGeo = new THREE.BoxGeometry(0.16, 0.22, length * 0.95);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(side * (width * 0.5 + 0.08), 0.28, 0);
    rail.renderOrder = 22;
    rail.userData.procedural = true;
    group.add(rail);
  }

  // Entrance chevrons pointing into the slip (local -Z approach).
  const chevronMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#5dff9a',
    emissiveIntensity: 2.0,
    transparent: true,
    opacity: 0.98,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  for (let i = 0; i < 3; i += 1) {
    const chevron = new THREE.Mesh(new THREE.CircleGeometry(0.6 - i * 0.08, 3), chevronMat);
    chevron.rotation.x = -Math.PI / 2;
    chevron.rotation.z = Math.PI;
    chevron.position.set(0, 0.26, -(length * 0.5 + 1.15 + i * 1.15));
    chevron.renderOrder = 23;
    chevron.userData.procedural = true;
    group.add(chevron);
  }

  // Corner posts sit OUTSIDE the berth so they don't block a parked hull.
  const side = width * 0.5 + 0.55;
  const end = length * 0.45;
  const corners: Array<[number, number]> = [
    [-side, -end],
    [side, -end],
    [-side, end],
    [side, end],
  ];
  for (const [cx, cz] of corners) {
    if (!models.has('cleat_post')) continue;
    const post = cloneModel(models, 'cleat_post');
    const bakedY = post.position.y;
    post.position.set(cx, bakedY, cz);
    post.scale.multiplyScalar(0.9);
    group.add(post);
    liftAboveWater(post, 0.2);
  }

  return { group, pad, pulse };
}

export function updateSlipMarker(
  marker: SlipMarker,
  elapsed: number,
  hold: number,
  _camera?: THREE.Camera,
): void {
  const pulseScale = 1 + Math.sin(elapsed * 2.2) * 0.05 + hold * 0.12;
  marker.pulse.scale.setScalar(pulseScale);
  const pulseMat = marker.pulse.material as THREE.MeshBasicMaterial;
  pulseMat.opacity = 0.45 + Math.sin(elapsed * 2.4) * 0.12 + hold * 0.25;

  const padMat = marker.pad.material as THREE.MeshStandardMaterial;
  padMat.emissiveIntensity = 1.8 + Math.sin(elapsed * 3.5) * 0.5 + hold * 1.1;
  padMat.opacity = 0.78 + hold * 0.18;
}
