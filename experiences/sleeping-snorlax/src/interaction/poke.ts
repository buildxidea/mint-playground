import * as THREE from "three";
import type { Snorlax } from "../scene/snorlax";
import type { SnoreBubble } from "../scene/snoreBubble";

export interface PokeSystem {
  update(dt: number): void;
  dispose(): void;
}

interface ZzzParticle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
}

function makeZzzTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 88px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 10;
  ctx.strokeText("Z", 64, 68);
  ctx.fillStyle = "#7f96c9";
  ctx.fillText("Z", 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Pointer handling for the figurative poke. A poke fires on release only when
 * the pointer barely moved, so dragging the camera never counts as a poke.
 */
export function createPokeSystem(options: {
  dom: HTMLElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  snorlax: Snorlax;
  bubble: SnoreBubble;
  /** Fired only when a poke connects, with the world point it landed on. */
  onPoke?: (worldPoint: THREE.Vector3) => void;
}): PokeSystem {
  const { dom, camera, scene, snorlax, bubble, onPoke } = options;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const zzzTexture = makeZzzTexture();
  const particles: ZzzParticle[] = [];

  let downX = 0;
  let downY = 0;
  let downAt = 0;
  let hoverDirty = false;

  function setPointerFromEvent(event: PointerEvent) {
    const rect = dom.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function hitsSnorlax(): THREE.Intersection | null {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(snorlax.pokeTarget, true);
    return hits.length > 0 ? hits[0] : null;
  }

  function spawnZzz(origin: THREE.Vector3, count: number) {
    // Read his size at spawn time: he grows with every waking, and the sprites
    // have to keep pace or they shrink into specks beside him.
    const particleSize = snorlax.sitHeight * 0.11;
    for (let i = 0; i < count; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: zzzTexture,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(particleSize * (0.7 + Math.random() * 0.8));
      sprite.position.copy(origin).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * particleSize * 2.8,
          Math.random() * particleSize * 0.8,
          (Math.random() - 0.5) * particleSize * 2.8,
        ),
      );
      scene.add(sprite);
      particles.push({
        sprite,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * particleSize * 3.2,
          particleSize * (2.2 + Math.random() * 1.8),
          (Math.random() - 0.5) * particleSize * 3.2,
        ),
        age: 0,
        lifetime: 1.4 + Math.random() * 0.8,
      });
    }
  }

  function onPointerDown(event: PointerEvent) {
    downX = event.clientX;
    downY = event.clientY;
    downAt = performance.now();
  }

  function onPointerUp(event: PointerEvent) {
    const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
    if (moved > 6 || performance.now() - downAt > 450) return;

    setPointerFromEvent(event);
    const hit = hitsSnorlax();
    if (!hit) return;

    snorlax.poke(hit.point, raycaster.ray.direction);
    bubble.jostle();
    spawnZzz(hit.point, 2 + Math.round(snorlax.annoyance * 4));
    // Only pokes that actually land on him score — anywhere on his body.
    onPoke?.(hit.point);
  }

  function onPointerMove(event: PointerEvent) {
    setPointerFromEvent(event);
    hoverDirty = true;
  }

  dom.addEventListener("pointerdown", onPointerDown);
  dom.addEventListener("pointerup", onPointerUp);
  dom.addEventListener("pointermove", onPointerMove);

  return {
    update(dt: number) {
      // Throttle hover raycasts to once per frame.
      if (hoverDirty) {
        hoverDirty = false;
        dom.style.cursor = hitsSnorlax() ? "pointer" : "default";
      }

      const rise = snorlax.sitHeight * 0.0275;
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const particle = particles[i];
        particle.age += dt;
        const t = particle.age / particle.lifetime;
        if (t >= 1) {
          scene.remove(particle.sprite);
          particle.sprite.material.dispose();
          particles.splice(i, 1);
          continue;
        }
        particle.velocity.y += rise * dt;
        particle.sprite.position.addScaledVector(particle.velocity, dt);
        particle.sprite.material.opacity = 0.95 * (1 - t * t);
        particle.sprite.material.rotation = Math.sin(particle.age * 3 + i) * 0.3;
      }
    },
    dispose() {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointermove", onPointerMove);
      particles.forEach((particle) => {
        scene.remove(particle.sprite);
        particle.sprite.material.dispose();
      });
      particles.length = 0;
      zzzTexture.dispose();
    },
  };
}
