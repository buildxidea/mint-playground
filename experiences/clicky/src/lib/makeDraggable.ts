import { ensurePropKeyboard, setActiveProp } from "./propKeyboard";
import {
  applyPropRotateAxis,
  captureBaseTransform,
  nudgePropRotate,
  readPropRotateDeg,
} from "./propTransform";

/** Stage visual scale — matches live heyclicky `y()` when a `.stage` is CSS-scaled. */
function stageScale(): number {
  const stage =
    document.querySelector<HTMLElement>(".stage") ??
    document.querySelector<HTMLElement>(".hero");
  if (!stage?.offsetWidth) return 1;
  return stage.getBoundingClientRect().width / stage.offsetWidth;
}

/** Containing block for absolute left/top (hero / section). */
function dragOrigin(el: HTMLElement): HTMLElement {
  return (
    el.closest<HTMLElement>(
      ".hero, .man-section, .fb, .pricing, .footer, .stage, section",
    ) ?? document.body
  );
}

let zCounter = 10;

/**
 * Live heyclicky drag: pointerdown → update left/top in stage coords,
 * raise z-index, suppress click after a real drag (>3px).
 * While holding:
 *   scroll → rotate Z · alt+scroll → Y · ctrl+scroll → X
 *   shift+drag → X (vertical) / Y (horizontal)
 */
export function makeDraggable(
  target: HTMLElement,
  handle: HTMLElement = target,
): () => void {
  ensurePropKeyboard();
  const ac = new AbortController();
  const { signal } = ac;

  handle.style.touchAction = "none";
  handle.style.pointerEvents = "auto";
  handle.classList.add("draggable");

  handle.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();

      setActiveProp(target);

      const scale = stageScale();
      const computed = getComputedStyle(target);
      let left = parseFloat(computed.left);
      let top = parseFloat(computed.top);

      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        const origin = dragOrigin(target).getBoundingClientRect();
        const box = target.getBoundingClientRect();
        left = (box.left - origin.left) / scale;
        top = (box.top - origin.top) / scale;
      }

      captureBaseTransform(target);
      // Ensure Z CSS rotate is initialized from current visual.
      applyPropRotateAxis(target, "z", readPropRotateDeg(target, "z"));

      let startX = event.clientX;
      let startY = event.clientY;
      let lastX = startX;
      let lastY = startY;
      let shifting = false;
      target.style.left = `${left}px`;
      target.style.top = `${top}px`;
      target.style.right = "auto";
      target.style.bottom = "auto";
      target.style.zIndex = String(++zCounter);
      handle.classList.add("dragging");
      document.documentElement.classList.add("is-holding-prop");

      let didDrag = false;

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.shiftKey) {
          if (!shifting) {
            shifting = true;
            const curLeft = parseFloat(target.style.left);
            const curTop = parseFloat(target.style.top);
            if (Number.isFinite(curLeft)) left = curLeft;
            if (Number.isFinite(curTop)) top = curTop;
          }
          const dY = (moveEvent.clientX - lastX) * 0.45;
          const dX = (moveEvent.clientY - lastY) * 0.45;
          if (Math.abs(dX) + Math.abs(dY) > 0.05) didDrag = true;
          if (dY !== 0) nudgePropRotate(target, "y", dY);
          if (dX !== 0) nudgePropRotate(target, "x", dX);
          lastX = moveEvent.clientX;
          lastY = moveEvent.clientY;
          return;
        }

        if (shifting) {
          shifting = false;
          const curLeft = parseFloat(target.style.left);
          const curTop = parseFloat(target.style.top);
          if (Number.isFinite(curLeft)) left = curLeft;
          if (Number.isFinite(curTop)) top = curTop;
          startX = moveEvent.clientX;
          startY = moveEvent.clientY;
        }

        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        const dx = (moveEvent.clientX - startX) / scale;
        const dy = (moveEvent.clientY - startY) / scale;
        if (!didDrag && Math.abs(dx) + Math.abs(dy) > 3) didDrag = true;
        target.style.left = `${left + dx}px`;
        target.style.top = `${top + dy}px`;
      };

      const onWheel = (wheelEvent: WheelEvent) => {
        wheelEvent.preventDefault();
        const delta = wheelEvent.deltaY * 0.12;
        if (wheelEvent.ctrlKey || wheelEvent.metaKey) {
          nudgePropRotate(target, "x", delta);
        } else if (wheelEvent.altKey) {
          nudgePropRotate(target, "y", delta);
        } else {
          nudgePropRotate(target, "z", delta);
        }
        didDrag = true;
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("wheel", onWheel);
        handle.classList.remove("dragging");
        document.documentElement.classList.remove("is-holding-prop");
        if (didDrag) {
          window.addEventListener(
            "click",
            (clickEvent) => {
              clickEvent.stopPropagation();
              clickEvent.preventDefault();
            },
            { capture: true, once: true, signal },
          );
        }
      };

      window.addEventListener("pointermove", onMove, { signal });
      window.addEventListener("pointerup", onUp, { signal });
      window.addEventListener("wheel", onWheel, { signal, passive: false });
    },
    { signal },
  );

  handle.addEventListener("dragstart", (event) => event.preventDefault(), {
    signal,
  });

  return () => {
    if (target.classList.contains("prop-active")) setActiveProp(null);
    document.documentElement.classList.remove("is-holding-prop");
    ac.abort();
  };
}
