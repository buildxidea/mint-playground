import * as THREE from "three";

export interface SnoreBubble {
  /** agitation 0..1 makes the bubble tremble as Snorlax gets bothered. */
  update(dt: number, breathPhase: number, agitation: number): void;
  /** Bursts the bubble. Returns true when one was actually popped. */
  pop(): boolean;
  /** A poke shakes the bubble without bursting it. */
  jostle(): void;
}

type BubbleState = "hidden" | "active" | "popping";

const POP_SECONDS = 0.26;

/**
 * Anime-style snore bubble that grows out of Snorlax's mouth. It swells on the
 * exhale, shrinks on the inhale, trembles as Snorlax gets annoyed, and only
 * bursts when Snorlax actually wakes up.
 */
export function createSnoreBubble(anchor: THREE.Object3D, options: { size: number }): SnoreBubble {
  const maxRadius = options.size;
  const group = new THREE.Group();

  const material = new THREE.MeshPhongMaterial({
    color: "#eaf7ff",
    transparent: true,
    opacity: 0.42,
    shininess: 90,
    specular: new THREE.Color("#ffffff"),
    depthWrite: false,
  });
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), material);

  const highlightMaterial = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });
  const highlight = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), highlightMaterial);
  highlight.position.set(-0.42, 0.42, 0.42);
  bubble.add(highlight);

  group.add(bubble);
  group.visible = false;
  anchor.add(group);

  let state: BubbleState = "hidden";
  let stateTime = 0;
  let hiddenDuration = 2.5 + Math.random() * 3;
  let activeDuration = 0;
  let appear = 0;
  let jostleEnergy = 0;

  function enter(next: BubbleState) {
    state = next;
    stateTime = 0;
    if (next === "hidden") {
      group.visible = false;
      hiddenDuration = 3 + Math.random() * 4;
      appear = 0;
    } else if (next === "active") {
      group.visible = true;
      activeDuration = 9 + Math.random() * 7;
      material.opacity = 0.42;
      highlightMaterial.opacity = 0.65;
    }
  }

  return {
    update(dt, breathPhase, agitation) {
      stateTime += dt;
      jostleEnergy = Math.max(0, jostleEnergy - dt * 2.2);

      if (state === "hidden") {
        if (stateTime >= hiddenDuration) enter("active");
        return;
      }

      if (state === "popping") {
        const t = Math.min(stateTime / POP_SECONDS, 1);
        const burst = 1 + t * 0.7;
        group.scale.setScalar(Math.max(maxRadius * appear * burst, 0.001));
        material.opacity = 0.42 * (1 - t);
        highlightMaterial.opacity = 0.65 * (1 - t);
        if (t >= 1) enter("hidden");
        return;
      }

      appear = Math.min(appear + dt / 1.4, 1);
      const breath = 0.5 - 0.5 * Math.cos(breathPhase * Math.PI * 2);
      // Idle shimmer, plus a faster tremble the more bothered Snorlax is.
      const tremble = (0.02 + agitation * 0.09) * Math.sin(stateTime * (5.1 + agitation * 22));
      const shake = jostleEnergy * 0.16 * Math.sin(stateTime * 40);
      const radius = maxRadius * appear * (0.55 + 0.45 * breath + tremble + shake);
      group.scale.setScalar(Math.max(radius, 0.001));
      // Float just outside the mouth, along the direction his face points, so
      // it works both sitting up and lying on his back.
      group.position.set(
        jostleEnergy * 0.06 * maxRadius * Math.sin(stateTime * 33),
        maxRadius * (0.22 + 0.08 * breath),
        maxRadius * 0.3 + radius * 0.8,
      );

      if (stateTime >= activeDuration) enter("hidden");
    },
    pop() {
      if (state !== "active") return false;
      state = "popping";
      stateTime = 0;
      return true;
    },
    jostle() {
      if (state === "active") jostleEnergy = 1;
    },
  };
}
