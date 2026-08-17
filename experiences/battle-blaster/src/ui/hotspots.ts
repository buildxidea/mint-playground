import type { HotspotProjection } from "../scene/showcase";
import type { SlotType } from "../data/arsenal";

/**
 * Numbered chips pinned to projected slot anchors. Chips are reused per slot
 * rather than rebuilt, so this runs cheaply inside the render loop.
 */
export class Hotspots {
  private chips = new Map<SlotType, HTMLElement>();
  private layer: HTMLElement;

  constructor(root: HTMLElement) {
    this.layer = document.createElement("div");
    this.layer.className = "hotspot-layer";
    this.layer.setAttribute("aria-hidden", "true");
    root.appendChild(this.layer);
  }

  update(spots: HotspotProjection[]): void {
    const seen = new Set<SlotType>();

    for (const spot of spots) {
      seen.add(spot.slot);
      let chip = this.chips.get(spot.slot);
      if (!chip) {
        chip = document.createElement("div");
        chip.className = "hotspot";
        chip.innerHTML = `<span class="hotspot-num"></span><span class="hotspot-label"></span>`;
        this.layer.appendChild(chip);
        this.chips.set(spot.slot, chip);
      }
      chip.querySelector<HTMLElement>(".hotspot-num")!.textContent = String(
        spot.index,
      ).padStart(2, "0");
      chip.querySelector<HTMLElement>(".hotspot-label")!.textContent = spot.label;
      chip.style.transform = `translate3d(${spot.x}px, ${spot.y}px, 0)`;
      chip.hidden = !spot.visible;
    }

    for (const [slot, chip] of this.chips) {
      if (!seen.has(slot)) chip.hidden = true;
    }
  }
}
