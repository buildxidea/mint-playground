import * as THREE from 'three';
import type { PropLibrary } from '../assets/props';
import type { CollisionWorld, SegmentCollider, SphereCollider } from '../sim/collision';
import type { HazardDef } from './routes';

/**
 * Moving hazards: a rotating crane jib and a patrolling blimp. Each owns its
 * visual and a dynamic collider that it rewrites in place every tick — the
 * colliders are registered once with the collision world.
 */
export interface Hazards {
  group: THREE.Group;
  update(elapsed: number): void;
}

/**
 * The crane model's origin is its bounding-box centre, which sits halfway
 * along the jib — rotating around it would swing the mast in a circle. Scan
 * the mesh for the true pivot instead: the centroid of the lowest vertices is
 * the mast base, and the farthest high vertex gives the jib's direction and
 * reach so the swept collider matches the visible arm.
 */
function analyzeCrane(crane: THREE.Object3D): {
  base: THREE.Vector2;
  jibDir: THREE.Vector2;
  jibLength: number;
} {
  crane.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(crane);
  const height = bounds.max.y - bounds.min.y;
  const lowY = bounds.min.y + height * 0.12;
  const highY = bounds.min.y + height * 0.75;

  const v = new THREE.Vector3();
  let baseX = 0;
  let baseZ = 0;
  let baseCount = 0;
  const top: Array<[number, number]> = [];
  crane.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 3) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (v.y < lowY) {
        baseX += v.x;
        baseZ += v.z;
        baseCount += 1;
      } else if (v.y > highY) {
        top.push([v.x, v.z]);
      }
    }
  });

  const base = new THREE.Vector2(
    baseCount > 0 ? baseX / baseCount : 0,
    baseCount > 0 ? baseZ / baseCount : 0,
  );
  let jibLength = 1;
  const jibDir = new THREE.Vector2(1, 0);
  for (const [x, z] of top) {
    const distance = Math.hypot(x - base.x, z - base.y);
    if (distance > jibLength) {
      jibLength = distance;
      jibDir.set(x - base.x, z - base.y).normalize();
    }
  }
  return { base, jibDir, jibLength };
}

export function buildHazards(
  defs: HazardDef[],
  props: PropLibrary,
  collision: CollisionWorld,
): Hazards {
  const group = new THREE.Group();
  const updaters: Array<(elapsed: number) => void> = [];

  for (const def of defs) {
    if (def.kind === 'crane') {
      const crane = props.spawn('crane', def.height / 22);
      const { base, jibDir, jibLength } = analyzeCrane(crane);

      // Pivot at the mast base: the tower stays planted while the jib sweeps.
      const pivot = new THREE.Group();
      pivot.position.set(def.pos[0], 0, def.pos[1]);
      crane.position.set(-base.x, 0, -base.y);
      pivot.add(crane);
      group.add(pivot);

      if (jibLength > def.jib * 1.25) {
        console.warn(
          `crane at (${def.pos}) has a measured jib of ${jibLength.toFixed(1)}m vs authored ${def.jib}m — widen the route's clearance`,
        );
      }

      // Static mast: a slim box at the crane's centre.
      const mastBox = new THREE.Box3(
        new THREE.Vector3(def.pos[0] - 0.8, 0, def.pos[1] - 0.8),
        new THREE.Vector3(def.pos[0] + 0.8, def.height, def.pos[1] + 0.8),
      );
      collision.boxes.push({ box: mastBox, label: 'crane mast' });

      // Rotating jib: one swept segment tracking the visible arm.
      const jibCollider: SegmentCollider = {
        start: new THREE.Vector3(),
        end: new THREE.Vector3(),
        radius: 0.7,
        label: 'crane jib',
      };
      collision.segments.push(jibCollider);
      const jibY = def.height * 0.92;
      const reach = Math.min(jibLength, def.jib * 1.25);

      updaters.push((elapsed) => {
        const angle = elapsed * def.speed * Math.PI * 2;
        pivot.rotation.y = angle;
        // rotation.y maps local (x, z) to (x cos + z sin, z cos - x sin).
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const dx = jibDir.x * cos + jibDir.y * sin;
        const dz = jibDir.y * cos - jibDir.x * sin;
        jibCollider.start.set(def.pos[0], jibY, def.pos[1]);
        jibCollider.end.set(def.pos[0] + dx * reach, jibY, def.pos[1] + dz * reach);
      });
    } else {
      const blimp = props.spawn('blimp');
      group.add(blimp);
      const blimpCollider: SphereCollider = {
        center: new THREE.Vector3(),
        radius: 2.4,
        label: 'blimp',
      };
      collision.spheres.push(blimpCollider);

      updaters.push((elapsed) => {
        const angle = elapsed * def.speed * Math.PI * 2;
        const x = def.center[0] + Math.cos(angle) * def.radius;
        const z = def.center[2] + Math.sin(angle) * def.radius;
        blimp.position.set(x, def.center[1], z);
        // Nose-first along the direction of travel.
        blimp.rotation.y = -angle - Math.PI / 2;
        blimpCollider.center.set(x, def.center[1] + 1.2, z);
      });
    }
  }

  return {
    group,
    update(elapsed: number) {
      for (const update of updaters) update(elapsed);
    },
  };
}
