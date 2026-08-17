import * as THREE from "three";
import { CUSTOMIZER_PAINTS, CUSTOMIZER_WHEELS } from "../brand/brand";
import type { CarFleet } from "../scene/CarFleet";
import type { Stage } from "../scene/Stage";
import type { ScrollTimeline } from "../scroll/ScrollTimeline";

/**
 * All user interactions: door/hood buttons, exploded view with callouts, and
 * the 2026 customizer. State ownership: CarFleet owns car state; this module
 * owns UI state and mode transitions.
 */
export function wireInteractions(stage: Stage, fleet: CarFleet, timeline: ScrollTimeline) {
  let lastActive = -2;
  timeline.onChange((s) => {
    if (s.activeIndex !== lastActive) {
      lastActive = s.activeIndex;
      // cars auto-close when scrolled away; keep the buttons honest
      document.querySelectorAll<HTMLButtonElement>(".tool-btn").forEach((b) => {
        if (b.dataset.action === "doors") {
          b.classList.remove("is-on");
          b.textContent = "Open doors";
        } else if (b.dataset.action === "explode") {
          b.classList.remove("is-on");
        }
      });
      setCallouts(null);
    }
    // These are targets, not live values — Stage eases toward them each frame
    // so stepped wheel input reads as continuous motion.
    stage.eraTarget = s.eraFloat;
    stage.handoffT = s.handoffT;
    fleet.setReveal(s.revealT);
    fleet.setIntro(s.introT);

    // The aerial ring reveal — the one big camera move, used at both ends of
    // the page: the hero opens on it and scrolls down onto the first car, and
    // the finale rises back to it. Pull up and back until the whole plate
    // (center at z = -6) is in frame.
    const t = s.revealT;
    stage.revealTarget = t;
    stage.camOffsetTarget.set(t * -1.2, t * 13.5, t * 7.5);
    stage.targetOffsetTarget.set(0, t * -0.55, t * -6.0);
  });

  // ---------- tool buttons ----------
  const buttons = document.querySelectorAll<HTMLButtonElement>(".tool-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const era = btn.dataset.era!;
      const action = btn.dataset.action!;
      if (action === "doors") {
        const on = fleet.toggleDoors(era);
        btn.classList.toggle("is-on", on);
        btn.textContent = on ? "Close doors" : "Open doors";
      } else if (action === "explode") {
        const on = !btn.classList.contains("is-on");
        fleet.setExplode(era, on);
        btn.classList.toggle("is-on", on);
        setCallouts(on ? era : null);
      }
    });
  });

  // door/hood control lives in the chapter toolbar only — no 3D hotspots
  const overlay = document.getElementById("overlay")!;
  const project = new THREE.Vector3();

  // ---------- explode callouts ----------
  const calloutDefs: { part: "hood" | "doorL" | "doorR"; label: string }[] = [
    { part: "hood", label: "Hood — pressed steel" },
    { part: "doorL", label: "Door, left" },
    { part: "doorR", label: "Door, right" },
  ];
  const callouts = calloutDefs.map((def) => {
    const el = document.createElement("span");
    el.className = "callout is-hidden";
    el.textContent = def.label;
    overlay.appendChild(el);
    return { ...def, el };
  });
  let calloutEra: string | null = null;
  const setCallouts = (era: string | null) => (calloutEra = era);

  stage.onUpdate(() => {
    callouts.forEach(({ el, part }) => {
      if (!calloutEra || fleet.isPlaceholder(calloutEra) ||
        !fleet.partWorldPosition(calloutEra, part, project)) {
        el.classList.add("is-hidden");
        return;
      }
      project.project(stage.camera);
      el.classList.remove("is-hidden");
      el.style.left = `${((project.x + 1) / 2) * window.innerWidth + 12}px`;
      el.style.top = `${((1 - project.y) / 2) * window.innerHeight}px`;
    });
  });

  // ---------- customizer (2026) ----------
  const paintRow = document.getElementById("paint-row");
  const wheelRow = document.getElementById("wheel-row");

  const swatch = (hex: string, name: string, active: boolean) => {
    const b = document.createElement("button");
    b.className = `swatch${active ? " is-active" : ""}`;
    b.style.background = hex;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(active));
    b.setAttribute("aria-label", name);
    b.title = name;
    return b;
  };

  // Guarded separately on purpose. A single-mesh car has no addressable
  // wheels, so its chapter renders no wheel row — and every era is single-mesh
  // today. Requiring both rows here meant the paint swatches silently stopped
  // rendering too, leaving an empty "Paint" heading on the 2026 chapter.
  if (paintRow) {
    const nameEl = document.createElement("span");
    nameEl.className = "swatch-name";
    nameEl.textContent = CUSTOMIZER_PAINTS[0].name;

    CUSTOMIZER_PAINTS.forEach((p, i) => {
      const b = swatch(p.hex, p.name, i === 0);
      b.addEventListener("click", () => {
        fleet.setPaint(p.hex);
        nameEl.textContent = p.name;
        paintRow.querySelectorAll(".swatch").forEach((s) => {
          s.classList.remove("is-active");
          s.setAttribute("aria-checked", "false");
        });
        b.classList.add("is-active");
        b.setAttribute("aria-checked", "true");
      });
      paintRow.appendChild(b);
    });
    paintRow.appendChild(nameEl);
  }

  if (wheelRow) {
    CUSTOMIZER_WHEELS.forEach((w, i) => {
      const b = swatch(w.hex, w.name, i === 0);
      b.addEventListener("click", () => {
        fleet.setWheelFinish(w.hex);
        wheelRow.querySelectorAll(".swatch").forEach((s) => {
          s.classList.remove("is-active");
          s.setAttribute("aria-checked", "false");
        });
        b.classList.add("is-active");
        b.setAttribute("aria-checked", "true");
      });
      wheelRow.appendChild(b);
    });
  }
}
