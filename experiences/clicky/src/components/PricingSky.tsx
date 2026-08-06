import { useEffect, useRef } from "react";
import { assetUrl } from "../lib/assetUrl";

declare global {
  interface Window {
    __VERIFY_FREEZE__?: boolean;
  }
}

/** Lightweight stand-in for live site's canvas.pricing-sky (clouds over blue). */
export function PricingSky() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const t0 = performance.now();
    let frozen = false;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const cloud = (x: number, y: number, s: number, a: number) => {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(x, y, s * 1.6, s * 0.7, 0, 0, Math.PI * 2);
      ctx.ellipse(x - s * 0.9, y + s * 0.1, s, s * 0.55, 0, 0, Math.PI * 2);
      ctx.ellipse(x + s * 0.95, y + s * 0.05, s * 1.1, s * 0.6, 0, 0, Math.PI * 2);
      ctx.ellipse(x + s * 0.2, y - s * 0.35, s * 0.9, s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const skyImg = new Image();
    skyImg.src = assetUrl("pr-sky.webp");

    const paint = (t: number) => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;

      if (skyImg.complete && skyImg.naturalWidth > 0) {
        // Cover-fit the live sky plate, then soft fade into page bg
        const scale = Math.max(w / skyImg.naturalWidth, h / skyImg.naturalHeight);
        const dw = skyImg.naturalWidth * scale;
        const dh = skyImg.naturalHeight * scale;
        ctx.drawImage(skyImg, (w - dw) / 2, 0, dw, dh);
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "#2a6fb5");
        g.addColorStop(0.35, "#4f93cc");
        g.addColorStop(0.62, "#9ec4e6");
        g.addColorStop(0.82, "#dcecf7");
        g.addColorStop(1, "#f5f5f5");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      const fade = ctx.createLinearGradient(0, h * 0.55, 0, h);
      fade.addColorStop(0, "rgba(245,245,245,0)");
      fade.addColorStop(1, "rgb(245,245,245)");
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, w, h);

      if (!skyImg.complete) {
        const drift = frozen ? 40 : (t * 8) % (w + 400);
        cloud(((w * 0.15 + drift * 0.15) % (w + 200)) - 100, h * 0.18, 54, 0.55);
        cloud(((w * 0.55 + drift * 0.1) % (w + 240)) - 80, h * 0.12, 70, 0.48);
      }
    };
    skyImg.onload = () => paint(0);

    const draw = (now: number) => {
      frozen = Boolean(window.__VERIFY_FREEZE__);
      paint((now - t0) / 1000);
      if (!frozen) raf = requestAnimationFrame(draw);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (frozen) paint(0);
    });
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="pricing-sky" aria-hidden="true" />;
}
