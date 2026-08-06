export type RotAxis = "x" | "y" | "z";

const AXIS_KEY: Record<RotAxis, "propRotateX" | "propRotateY" | "propRotateZ"> =
  {
    x: "propRotateX",
    y: "propRotateY",
    z: "propRotateZ",
  };

const AXIS_BASE: Record<
  RotAxis,
  "propRotateXBase" | "propRotateYBase" | "propRotateZBase"
> = {
  x: "propRotateXBase",
  y: "propRotateYBase",
  z: "propRotateZBase",
};

function wrapDeg(deg: number): number {
  const normalized = ((deg % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

export function captureBaseTransform(el: HTMLElement) {
  if (el.dataset.propBaseTransform !== undefined) return;
  const inline = el.style.transform || "";
  el.dataset.propBaseTransform = inline
    .replace(/\s*rotate\([^)]*\)/g, "")
    .trim();
}

function cssZDeg(el: HTMLElement): number {
  // Legacy single-axis store
  const legacy = parseFloat(el.dataset.propRotate ?? "");
  if (Number.isFinite(legacy)) return legacy;
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  try {
    const m = new DOMMatrix(t);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  } catch {
    return 0;
  }
}

/** Seed authored Euler degrees (from manifest) once so nudges start there. */
export function seedPropRotationBases(
  el: HTMLElement,
  rotationRad: [number, number, number],
) {
  if (el.dataset.propRotateXBase === undefined) {
    el.dataset.propRotateXBase = String((rotationRad[0] * 180) / Math.PI);
  }
  if (el.dataset.propRotateYBase === undefined) {
    el.dataset.propRotateYBase = String((rotationRad[1] * 180) / Math.PI);
  }
  if (el.dataset.propRotateZBase === undefined) {
    el.dataset.propRotateZBase = String((rotationRad[2] * 180) / Math.PI);
  }
  // Migrate CSS/legacy Z into propRotateZ the first time we see the element.
  if (el.dataset.propRotateZ === undefined && el.dataset.propRotate !== undefined) {
    el.dataset.propRotateZ = el.dataset.propRotate;
  }
}

export function readPropRotateDeg(el: HTMLElement, axis: RotAxis): number {
  const key = AXIS_KEY[axis];
  const stored = parseFloat(el.dataset[key] ?? "");
  if (Number.isFinite(stored)) return stored;
  if (axis === "z") {
    const z = cssZDeg(el);
    if (z !== 0 || el.dataset.propRotate !== undefined) return z;
  }
  const base = parseFloat(el.dataset[AXIS_BASE[axis]] ?? "");
  return Number.isFinite(base) ? base : 0;
}

/** Radians for follow-DOM, falling back to authored manifest rotation. */
export function readPropRotateRad(
  el: HTMLElement,
  axis: RotAxis,
  fallbackRad: number,
): number {
  const key = AXIS_KEY[axis];
  const stored = parseFloat(el.dataset[key] ?? "");
  if (Number.isFinite(stored)) return (stored * Math.PI) / 180;
  if (axis === "z") {
    const legacy = parseFloat(el.dataset.propRotate ?? "");
    if (Number.isFinite(legacy)) return (legacy * Math.PI) / 180;
  }
  return fallbackRad;
}

export function applyPropRotateAxis(
  el: HTMLElement,
  axis: RotAxis,
  deg: number,
) {
  captureBaseTransform(el);
  const signed = wrapDeg(deg);
  el.dataset[AXIS_KEY[axis]] = String(signed);
  if (axis === "z") {
    // Keep 2D CSS spin in sync (X/Y only affect the 3D mesh).
    el.dataset.propRotate = String(signed);
    const base = el.dataset.propBaseTransform || "";
    const rot = `rotate(${signed}deg)`;
    el.style.transform = base ? `${base} ${rot}` : rot;
  }
}

export function nudgePropRotate(
  el: HTMLElement,
  axis: RotAxis,
  deltaDeg: number,
) {
  applyPropRotateAxis(el, axis, readPropRotateDeg(el, axis) + deltaDeg);
}
