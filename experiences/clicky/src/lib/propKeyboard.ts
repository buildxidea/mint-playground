import { nudgePropRotate } from "./propTransform";

/** Last sticker/window the user grabbed — keyboard nudges target this. */
let active: HTMLElement | null = null;

function stageScale(): number {
  const stage =
    document.querySelector<HTMLElement>(".stage") ??
    document.querySelector<HTMLElement>(".hero");
  if (!stage?.offsetWidth) return 1;
  return stage.getBoundingClientRect().width / stage.offsetWidth;
}

function dragOrigin(el: HTMLElement): HTMLElement {
  return (
    el.closest<HTMLElement>(
      ".hero, .man-section, .fb, .pricing, .footer, .stage, section",
    ) ?? document.body
  );
}

function ensureLeftTop(el: HTMLElement): { left: number; top: number } {
  const computed = getComputedStyle(el);
  let left = parseFloat(computed.left);
  let top = parseFloat(computed.top);

  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    const scale = stageScale();
    const origin = dragOrigin(el).getBoundingClientRect();
    const box = el.getBoundingClientRect();
    left = (box.left - origin.left) / scale;
    top = (box.top - origin.top) / scale;
  }

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
  return { left, top };
}

const Z_MIN = -2.5;
const Z_MAX = 2.5;

function readPropZ(el: HTMLElement): number {
  const z = parseFloat(el.dataset.propZ ?? "");
  if (Number.isFinite(z)) return z;
  const base = parseFloat(el.dataset.propZBase ?? "");
  return Number.isFinite(base) ? base : 0;
}

function clampZ(z: number): number {
  return Math.max(Z_MIN, Math.min(Z_MAX, z));
}

export function setActiveProp(el: HTMLElement | null) {
  if (active && active !== el) active.classList.remove("prop-active");
  active = el;
  if (active) {
    active.classList.add("prop-active");
    document.documentElement.classList.add("has-active-prop");
  } else {
    document.documentElement.classList.remove("has-active-prop");
  }
}

export function getActiveProp(): HTMLElement | null {
  return active;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    t.isContentEditable
  );
}

function onKeyDown(event: KeyboardEvent) {
  if (!active || !active.isConnected) {
    if (active) setActiveProp(null);
    return;
  }
  if (isTypingTarget(event.target)) return;
  // Place-mode owns arrow / bracket keys when it's on.
  if (document.querySelector(".scene-overlay.place-on")) return;

  const step = event.shiftKey ? 16 : 4;
  const rotStep = event.shiftKey ? 12 : 4;
  const zStep = event.shiftKey ? 0.35 : 0.12;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  let handled = false;

  if (
    event.key === "ArrowLeft" ||
    event.key === "ArrowRight" ||
    event.key === "ArrowUp" ||
    event.key === "ArrowDown"
  ) {
    const { left, top } = ensureLeftTop(active);
    let nextLeft = left;
    let nextTop = top;
    if (event.key === "ArrowLeft") nextLeft -= step;
    if (event.key === "ArrowRight") nextLeft += step;
    if (event.key === "ArrowUp") nextTop -= step;
    if (event.key === "ArrowDown") nextTop += step;
    active.style.left = `${nextLeft}px`;
    active.style.top = `${nextTop}px`;
    handled = true;
  } else if (event.key === "[" || event.key === "{") {
    active.dataset.propZ = String(clampZ(readPropZ(active) + zStep));
    handled = true;
  } else if (event.key === "]" || event.key === "}") {
    active.dataset.propZ = String(clampZ(readPropZ(active) - zStep));
    handled = true;
  } else if (key === "i") {
    nudgePropRotate(active, "x", -rotStep);
    handled = true;
  } else if (key === "k") {
    nudgePropRotate(active, "x", rotStep);
    handled = true;
  } else if (key === "u") {
    nudgePropRotate(active, "y", -rotStep);
    handled = true;
  } else if (key === "o") {
    nudgePropRotate(active, "y", rotStep);
    handled = true;
  } else if (event.key === "," || event.key === "<") {
    nudgePropRotate(active, "z", -rotStep);
    handled = true;
  } else if (event.key === "." || event.key === ">") {
    nudgePropRotate(active, "z", rotStep);
    handled = true;
  } else if (event.key === "Escape") {
    setActiveProp(null);
    handled = true;
  }

  if (handled) {
    event.preventDefault();
    event.stopPropagation();
  }
}

let listening = false;

/** Install once — safe to call from multiple draggable mounts. */
export function ensurePropKeyboard() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("keydown", onKeyDown);
}
