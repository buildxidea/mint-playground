import * as THREE from "three";
import { Turntable, PLATE_RADIUS, PLATE_TOP_Y, STATION_STEP } from "./Turntable";
import { ERAS } from "../brand/brand";

/**
 * Six pie-slice landscapes on the turntable, one per generation. Terrain is
 * procedural (displaced ring-sector + decals); Mint-generated props are
 * scattered in by `addProp` once their packs are synchronized.
 */

interface SliceSpec {
  ground: string;
  groundRough: number;
  groundMetal?: number;
  rim: string;
  /** vertical noise amplitude away from the car pad */
  amp: number;
  decal: "road" | "asphalt" | "puddles" | "tracks" | "gravel" | "pool" | "jroad" | "none";
}

const SLICES: Record<string, SliceSpec> = {
  // dust-bowl desert trail — the desert moved here from 2004
  "car-1948": { ground: "#a5865c", groundRough: 1.0, rim: "#8a7150", amp: 0.2, decal: "tracks" },
  "car-1965": { ground: "#8a8578", groundRough: 0.9, rim: "#6d6a5e", amp: 0.16, decal: "asphalt" },
  "car-1987": { ground: "#0b0d12", groundRough: 0.25, groundMetal: 0.4, rim: "#14161c", amp: 0.03, decal: "puddles" },
  // clean modern Japanese two-lane road
  "car-2004": { ground: "#26282b", groundRough: 0.7, rim: "#3a3d41", amp: 0.015, decal: "jroad" },
  // seamless flat Tesla-studio floor
  "car-2026": { ground: "#a2a6aa", groundRough: 0.55, rim: "#8e9296", amp: 0, decal: "none" },
  "car-2040": { ground: "#0a0e13", groundRough: 0.4, groundMetal: 0.3, rim: "#080b0f", amp: 0.02, decal: "pool" },
};

const INNER_RADIUS = 1.25;
/** station point in slice-local space (slice group carries the station yaw) */
const STATION_LOCAL = new THREE.Vector3(0, 0, 6);

function hashNoise(a: number, r: number) {
  return (
    Math.sin(a * 3.1 + r * 1.7) * 0.5 +
    Math.sin(a * 7.3 - r * 2.9) * 0.3 +
    Math.sin(a * 13.7 + r * 5.3) * 0.2
  );
}

export class Dioramas {
  private slices = new Map<string, THREE.Group>();

  constructor(turntable: Turntable) {
    ERAS.forEach((era, i) => {
      const spec = SLICES[era.key];
      const slice = new THREE.Group();
      slice.rotation.y = i * STATION_STEP;
      slice.position.y = PLATE_TOP_Y;
      this.buildTerrain(slice, spec);
      this.buildDecal(slice, spec);
      turntable.group.add(slice);
      this.slices.set(era.key, slice);
    });
  }

  private buildTerrain(slice: THREE.Group, spec: SliceSpec) {
    // ring sector lying flat, centered on the slice's +Z (station) direction
    const geo = new THREE.RingGeometry(
      INNER_RADIUS, PLATE_RADIUS, 26, 10,
      -Math.PI / 2 - STATION_STEP / 2, STATION_STEP,
    );
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      // plane XY → world XZ after rotation.x = -PI/2: (x, y) → (x, -y·(-1)) …
      v.set(pos.getX(i), pos.getY(i), 0);
      const world = new THREE.Vector3(v.x, 0, -v.y); // post-rotation mapping
      const distToPad = world.distanceTo(STATION_LOCAL);
      const r = Math.hypot(v.x, v.y);
      const a = Math.atan2(v.y, v.x);
      const pad = THREE.MathUtils.smoothstep(distToPad, 2.6, 4.2);
      const rimFade = THREE.MathUtils.smoothstep(r, INNER_RADIUS, 2.6);
      const h = Math.max(0, hashNoise(a * 4, r) * spec.amp) * pad * rimFade;
      pos.setZ(i, h);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.ground),
      roughness: spec.groundRough,
      metalness: spec.groundMetal ?? 0,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.012;
    ground.receiveShadow = true;
    slice.add(ground);

    // low parapet arc at the rim so slices read as distinct worlds
    const parapet = new THREE.Mesh(
      new THREE.CylinderGeometry(
        PLATE_RADIUS - 0.12, PLATE_RADIUS - 0.12, 0.2, 24, 1, true,
        Math.PI - STATION_STEP / 2 + 0.01, STATION_STEP - 0.02,
      ),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(spec.rim),
        roughness: 0.8,
        side: THREE.DoubleSide,
      }),
    );
    parapet.position.y = 0.1;
    slice.add(parapet);
  }

  private buildDecal(slice: THREE.Group, spec: SliceSpec) {
    const s = STATION_LOCAL;
    const add = (mesh: THREE.Mesh) => {
      mesh.rotation.x = -Math.PI / 2;
      mesh.receiveShadow = true;
      slice.add(mesh);
    };

    switch (spec.decal) {
      case "road": {
        const road = new THREE.Mesh(
          new THREE.PlaneGeometry(3.4, 7.2),
          new THREE.MeshStandardMaterial({ color: 0x584c39, roughness: 1 }),
        );
        road.position.set(s.x, 0.02, s.z);
        add(road);
        break;
      }
      case "asphalt": {
        const road = new THREE.Mesh(
          new THREE.PlaneGeometry(3.6, 7.2),
          new THREE.MeshStandardMaterial({ color: 0x3d3f41, roughness: 0.85 }),
        );
        road.position.set(s.x, 0.02, s.z);
        add(road);
        const line = new THREE.Mesh(
          new THREE.PlaneGeometry(0.12, 6.4),
          new THREE.MeshStandardMaterial({ color: 0xd8d2bd, roughness: 0.9 }),
        );
        line.position.set(s.x - 1.5, 0.028, s.z);
        add(line);
        break;
      }
      case "puddles": {
        for (const [dx, dz, r] of [[-1.6, 1.2, 0.9], [1.4, -1.5, 1.2], [0.4, 2.4, 0.6]] as const) {
          const puddle = new THREE.Mesh(
            new THREE.CircleGeometry(r, 24),
            new THREE.MeshStandardMaterial({
              color: 0x0d1118, roughness: 0.04, metalness: 0.85,
            }),
          );
          puddle.position.set(s.x + dx, 0.022, s.z + dz);
          add(puddle);
        }
        break;
      }
      case "tracks": {
        for (const dx of [-0.72, 0.72]) {
          const track = new THREE.Mesh(
            new THREE.PlaneGeometry(0.42, 7.0),
            new THREE.MeshStandardMaterial({ color: 0x97794f, roughness: 1 }),
          );
          track.position.set(s.x + dx, 0.02, s.z);
          add(track);
        }
        break;
      }
      case "gravel": {
        const pad = new THREE.Mesh(
          new THREE.CircleGeometry(3.0, 32),
          new THREE.MeshStandardMaterial({ color: 0x87857e, roughness: 1 }),
        );
        pad.position.set(s.x, 0.02, s.z);
        add(pad);
        break;
      }
      case "jroad": {
        // smooth asphalt band with crisp white edge lines + dashed center
        const lane = new THREE.Mesh(
          new THREE.PlaneGeometry(4.6, 7.4),
          new THREE.MeshStandardMaterial({ color: 0x2e3134, roughness: 0.6 }),
        );
        lane.position.set(s.x, 0.02, s.z);
        add(lane);
        for (const dx of [-2.05, 2.05]) {
          const edge = new THREE.Mesh(
            new THREE.PlaneGeometry(0.14, 7.2),
            new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.8 }),
          );
          edge.position.set(s.x + dx, 0.028, s.z);
          add(edge);
        }
        for (let i = 0; i < 5; i++) {
          const dash = new THREE.Mesh(
            new THREE.PlaneGeometry(0.12, 0.8),
            new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.8 }),
          );
          dash.position.set(s.x, 0.028, s.z - 3.0 + i * 1.5);
          add(dash);
        }
        break;
      }
      case "none":
        break;
      case "pool": {
        // Was a near-perfect mirror (roughness 0.02, metalness 1) which
        // reflected the teal rim spot as a blinding green streak across the
        // floor. Rougher and much less metallic: still a damp sheen, but it
        // scatters the highlight instead of mirroring it back at full power.
        const pool = new THREE.Mesh(
          new THREE.CircleGeometry(3.3, 48),
          new THREE.MeshStandardMaterial({
            color: 0x04070b, roughness: 0.55, metalness: 0.25,
          }),
        );
        pool.position.set(s.x, 0.024, s.z);
        add(pool);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(3.3, 3.42, 48),
          new THREE.MeshBasicMaterial({ color: 0x5de0c8, transparent: true, opacity: 0.32 }),
        );
        ring.position.set(s.x, 0.026, s.z);
        add(ring);
        // Soft under-glow beneath the hovering car. Normal blending, not
        // additive: additive stacked on the dark floor and clipped straight
        // to white-green, which is what read as a hot blob under the car.
        const glow = new THREE.Mesh(
          new THREE.CircleGeometry(1.9, 40),
          new THREE.MeshBasicMaterial({
            color: 0x2f7d70, transparent: true, opacity: 0.3, depthWrite: false,
          }),
        );
        glow.position.set(s.x, 0.03, s.z);
        add(glow);
        break;
      }
    }
  }

  /** place a synced Mint prop in an era slice (position local to the slice) */
  addProp(
    eraKey: string,
    object: THREE.Object3D,
    position: [number, number, number],
    yaw = 0,
    scale = 1,
  ) {
    const slice = this.slices.get(eraKey);
    if (!slice) return;
    object.position.set(...position);
    object.rotation.y = yaw;
    object.scale.multiplyScalar(scale);
    slice.add(object);
  }
}
