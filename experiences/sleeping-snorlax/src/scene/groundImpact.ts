import * as THREE from "three";

export interface GroundImpact {
  /** radius is the world-space reach of the dust, matched to Snorlax's size. */
  burst(position: THREE.Vector3, radius: number): void;
  update(dt: number): void;
  dispose(): void;
}

function makeRingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(128, 128, 74, 128, 128, 126);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
  gradient.addColorStop(0.55, "rgba(246, 250, 235, 0.85)");
  gradient.addColorStop(1, "rgba(246, 250, 235, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makePuffTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, "rgba(252, 250, 238, 0.95)");
  gradient.addColorStop(0.6, "rgba(226, 232, 206, 0.5)");
  gradient.addColorStop(1, "rgba(226, 232, 206, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Puff {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  spin: number;
  /** World units the puff swells by over its life. */
  growth: number;
}

/**
 * Dust ring plus scattering puffs for the moment Snorlax flops back down.
 * Purely cosmetic: nothing here participates in picking or physics.
 */
export function createGroundImpact(scene: THREE.Scene): GroundImpact {
  const ringTexture = makeRingTexture();
  const puffTexture = makePuffTexture();

  const ringMaterial = new THREE.MeshBasicMaterial({
    map: ringTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  const puffs: Puff[] = [];
  let ringAge = 0;
  let ringLife = 0;
  let ringScale = 1;

  return {
    burst(position, radius) {
      ring.position.copy(position);
      ring.visible = true;
      ringAge = 0;
      ringLife = 0.8;
      ringScale = radius * 2.4;

      const count = 11;
      for (let i = 0; i < count; i += 1) {
        const material = new THREE.SpriteMaterial({
          map: puffTexture,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.setScalar(radius * (0.22 + Math.random() * 0.18));
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const spawn = radius * (0.45 + Math.random() * 0.3);
        sprite.position.set(
          position.x + Math.cos(angle) * spawn,
          position.y + radius * 0.05,
          position.z + Math.sin(angle) * spawn,
        );
        scene.add(sprite);
        puffs.push({
          sprite,
          velocity: new THREE.Vector3(
            Math.cos(angle) * radius * (0.55 + Math.random() * 0.35),
            radius * (0.3 + Math.random() * 0.25),
            Math.sin(angle) * radius * (0.55 + Math.random() * 0.35),
          ),
          age: 0,
          lifetime: 0.9 + Math.random() * 0.6,
          spin: (Math.random() - 0.5) * 2,
          growth: radius * 0.09,
        });
      }
    },
    update(dt) {
      if (ring.visible) {
        ringAge += dt;
        const t = Math.min(ringAge / ringLife, 1);
        const eased = 1 - Math.pow(1 - t, 2.5);
        ring.scale.setScalar(0.8 + ringScale * eased);
        ringMaterial.opacity = 0.75 * (1 - t) * (1 - t);
        if (t >= 1) ring.visible = false;
      }

      for (let i = puffs.length - 1; i >= 0; i -= 1) {
        const puff = puffs[i];
        puff.age += dt;
        const t = puff.age / puff.lifetime;
        if (t >= 1) {
          scene.remove(puff.sprite);
          puff.sprite.material.dispose();
          puffs.splice(i, 1);
          continue;
        }
        puff.velocity.multiplyScalar(1 - 1.8 * dt); // air drag
        puff.velocity.y -= puff.growth * 3 * dt;
        puff.sprite.position.addScaledVector(puff.velocity, dt);
        puff.sprite.scale.setScalar(puff.growth * (2.4 + t * 5));
        puff.sprite.material.opacity = 0.9 * (1 - t * t);
        puff.sprite.material.rotation += puff.spin * dt;
      }
    },
    dispose() {
      scene.remove(ring);
      ringMaterial.dispose();
      ring.geometry.dispose();
      puffs.forEach((puff) => {
        scene.remove(puff.sprite);
        puff.sprite.material.dispose();
      });
      puffs.length = 0;
      ringTexture.dispose();
      puffTexture.dispose();
    },
  };
}
