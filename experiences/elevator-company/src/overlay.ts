import { STOPS, ROOF_STORY, type PassengerDef } from "./content";
import type { RideState } from "./timeline";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing overlay element #${id}`);
  return node as T;
}

export class Overlay {
  private floorNumber = el<HTMLSpanElement>("floor-number");
  private story = el<HTMLElement>("story");
  private storyKicker = el<HTMLParagraphElement>("story-kicker");
  private storyTitle = el<HTMLHeadingElement>("story-title");
  private storyQuote = el<HTMLParagraphElement>("story-quote");
  private storyProduct = el<HTMLParagraphElement>("story-product");
  private kanji = el<HTMLDivElement>("kanji");
  private kanjiText = el<HTMLSpanElement>("kanji-text");
  private kanjiReading = el<HTMLSpanElement>("kanji-reading");
  private intro = el<HTMLDivElement>("intro");
  private outro = el<HTMLDivElement>("outro");
  private holdBtn = el<HTMLButtonElement>("hold-doors");
  private card = el<HTMLDivElement>("passenger-card");
  private cardName = el<HTMLParagraphElement>("pc-name");
  private cardFloor = el<HTMLParagraphElement>("pc-floor");
  private cardStory = el<HTMLParagraphElement>("pc-story");
  private tip = el<HTMLDivElement>("button-tip");

  private lastFloorLabel = "";
  private lastStopIndex = -1;

  update(state: RideState): void {
    const label =
      state.finale > 0.02
        ? "R"
        : state.displayStory === 0
          ? "G"
          : state.displayStory >= ROOF_STORY
            ? "R"
            : String(state.displayStory);
    if (label !== this.lastFloorLabel) {
      this.lastFloorLabel = label;
      this.floorNumber.textContent = label;
    }

    const stop = STOPS[state.stopIndex];
    if (state.stopIndex !== this.lastStopIndex) {
      this.lastStopIndex = state.stopIndex;
      this.storyKicker.textContent = stop.kicker;
      this.storyTitle.textContent = stop.title;
      this.storyQuote.textContent = stop.quote;
      this.storyProduct.textContent = stop.product;
      this.kanjiText.textContent = stop.kanji;
      this.kanjiReading.textContent = stop.reading;
    }

    const showStory =
      state.atStop && stop.title.length > 0 && state.finale === 0;
    this.story.classList.toggle("visible", showStory);
    this.kanji.classList.toggle(
      "visible",
      (state.atStop || state.finale > 0) && state.outroVisible === false,
    );

    this.intro.style.opacity = state.introVisible ? "1" : "0";
    this.outro.classList.toggle("visible", state.outroVisible);

    const holdAvailable =
      state.atStop && state.finale === 0 && stop.story !== ROOF_STORY;
    this.holdBtn.classList.toggle("available", holdAvailable);
  }

  setHolding(holding: boolean): void {
    this.holdBtn.classList.toggle("holding", holding);
  }

  showPassengerCard(def: PassengerDef, x: number, y: number): void {
    this.cardName.textContent = def.name;
    this.cardFloor.textContent = `TRAVELLING TO FLOOR / ${
      def.exitStory === ROOF_STORY ? "R" : String(def.exitStory).padStart(2, "0")
    }`;
    this.cardStory.textContent = def.story;
    this.positionFloating(this.card, x, y);
    this.card.classList.add("visible");
  }

  hidePassengerCard(): void {
    this.card.classList.remove("visible");
  }

  showButtonTip(label: string, x: number, y: number): void {
    this.tip.textContent =
      label === "G" ? "GROUND" : label === "R" ? "ROOF" : `FLOOR ${label}`;
    this.positionFloating(this.tip, x, y);
    this.tip.classList.add("visible");
  }

  hideButtonTip(): void {
    this.tip.classList.remove("visible");
  }

  private positionFloating(node: HTMLElement, x: number, y: number): void {
    const pad = 14;
    const w = node.offsetWidth || 200;
    const h = node.offsetHeight || 80;
    const left = Math.min(Math.max(x + 18, pad), innerWidth - w - pad);
    const top = Math.min(Math.max(y - h / 2, pad), innerHeight - h - pad);
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }
}

export function setLoadingProgress(loaded: number, total: number): void {
  const bar = document.getElementById("loading-bar");
  if (bar) bar.style.width = `${total > 0 ? (loaded / total) * 100 : 0}%`;
}

export function setLoadingStatus(text: string): void {
  const status = document.getElementById("loading-status");
  if (status) status.textContent = text;
}

export function finishLoading(): void {
  setLoadingStatus("IN SERVICE");
  const loading = document.getElementById("loading");
  if (loading) loading.classList.add("done");
}

export function failLoading(message: string): void {
  setLoadingStatus(message.toUpperCase());
  const bar = document.getElementById("loading-bar");
  if (bar) bar.style.background = "#a3402e";
}
