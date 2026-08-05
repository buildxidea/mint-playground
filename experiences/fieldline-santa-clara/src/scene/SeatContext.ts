import * as THREE from "three";
import { MaterialLibrary } from "./MaterialLibrary";

export type SeatedContextKind = "exact-seat" | "representative-row-seat" | "ada-row-center";

function createTaperedBackGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.25, 0);
  shape.lineTo(0.25, 0);
  shape.lineTo(0.205, 0.52);
  shape.quadraticCurveTo(0.18, 0.6, 0.11, 0.62);
  shape.lineTo(-0.11, 0.62);
  shape.quadraticCurveTo(-0.18, 0.6, -0.205, 0.52);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.075,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.018,
    bevelThickness: 0.014,
    curveSegments: 5,
  });
  geometry.translate(0, 0.5, -0.3);
  geometry.computeVertexNormals();
  return geometry;
}

function createRepresentativeChair(materials: MaterialLibrary): THREE.Group {
  const group = new THREE.Group();
  group.name = "representative-chair-object";
  group.userData = {
    kind: "representative-chair",
    status: "modeled-calibration-pending",
    coordinateBasis: "seat-local +z forward, +y up, meters",
  };

  const upholstery = materials.burgundy.clone();
  upholstery.color.set(0x7b2333);
  upholstery.roughness = 0.78;
  const cushion = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.13, 0.48, 2, 1, 2),
    upholstery,
  );
  cushion.name = "representative-seat-cushion-object";
  cushion.position.set(0, 0.5, 0.16);
  cushion.rotation.x = -0.055;
  cushion.castShadow = true;
  cushion.receiveShadow = true;
  group.add(cushion);

  const back = new THREE.Mesh(createTaperedBackGeometry(), upholstery);
  back.name = "representative-seat-backrest-object";
  back.rotation.x = -0.09;
  back.castShadow = true;
  back.receiveShadow = true;
  group.add(back);

  const armGeometry = new THREE.BoxGeometry(0.065, 0.075, 0.38);
  for (const x of [-0.305, 0.305]) {
    const arm = new THREE.Mesh(armGeometry, materials.blackenedSteel);
    arm.name = "representative-seat-armrest-object";
    arm.position.set(x, 0.7, 0.2);
    arm.castShadow = true;
    group.add(arm);
  }

  const postGeometry = new THREE.CylinderGeometry(0.026, 0.035, 0.48, 8);
  for (const x of [-0.24, 0.24]) {
    const post = new THREE.Mesh(postGeometry, materials.blackenedSteel);
    post.name = "representative-seat-support-object";
    post.position.set(x, 0.24, -0.18);
    post.castShadow = true;
    group.add(post);
  }

  const crossbar = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.055, 0.055),
    materials.blackenedSteel,
  );
  crossbar.name = "representative-seat-crossbar-object";
  crossbar.position.set(0, 0.34, -0.24);
  group.add(crossbar);
  return group;
}

export function createRepresentativeSeatContext(materials: MaterialLibrary): THREE.Group {
  const context = new THREE.Group();
  context.name = "active-representative-seat-context-object";
  context.visible = false;
  context.userData = {
    kind: "representative-seat-context",
    status: "modeled-calibration-pending",
    coordinateBasis: "seat-local +z forward, +y up, meters",
    chairCount: 5,
    note: "A five-chair local context supports orientation; no individual identifiers are inferred.",
  };
  const center = createRepresentativeChair(materials);
  center.userData.role = "active-representative-chair";
  context.add(center);
  for (const lateralM of [-1.28, -0.64, 0.64, 1.28]) {
    const neighbor = center.clone(true);
    neighbor.position.x = lateralM;
    neighbor.userData = {
      ...neighbor.userData,
      role: "unidentified-neighbor-context",
    };
    context.add(neighbor);
  }
  return context;
}

export function createActiveAdaContext(materials: MaterialLibrary): THREE.Group {
  const group = new THREE.Group();
  group.name = "active-ada-row-context-object";
  group.visible = false;
  group.userData = {
    kind: "ada-row-context",
    status: "modeled-calibration-pending",
    note: "Representative row-center platform; no individual wheelchair or companion position inferred.",
  };
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.12, 1.45),
    materials.concreteLight,
  );
  platform.name = "active-ada-platform-surface-object";
  platform.position.y = 0.03;
  platform.receiveShadow = true;
  group.add(platform);
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.78, 0.055),
    materials.paintedWhiteSteel,
  );
  edge.name = "active-ada-platform-rear-rail-object";
  edge.position.set(0, 0.42, -0.68);
  group.add(edge);
  return group;
}

export function createSeatRigDebugContext(): THREE.Group {
  const group = new THREE.Group();
  group.name = "active-seat-rig-debug-object";
  group.visible = false;
  const axes = new THREE.AxesHelper(0.85);
  axes.name = "seat-local-axis-helper";
  group.add(axes);
  const eyeEnvelope = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.16, 0.42, 5, 10),
    new THREE.MeshBasicMaterial({
      color: 0xb7e63b,
      wireframe: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  eyeEnvelope.name = "seat-occupant-clearance-envelope";
  eyeEnvelope.position.set(0, 0.94, 0.34);
  group.add(eyeEnvelope);
  return group;
}
