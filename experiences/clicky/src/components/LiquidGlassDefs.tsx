import { useEffect } from "react";
import { assetUrl } from "../lib/assetUrl";

/** Injects live site's #liquid-glass-card SVG filter for pricing cards. */
export function LiquidGlassDefs() {
  useEffect(() => {
    if (document.getElementById("liquid-glass-card-defs")) return;
    let cancelled = false;
    void fetch(assetUrl("liquid-glass-card-defs.svg"))
      .then((r) => r.text())
      .then((html) => {
        if (cancelled || document.getElementById("liquid-glass-card-defs")) return;
        const wrap = document.createElement("div");
        wrap.innerHTML = html.trim();
        const svg = wrap.firstElementChild;
        if (svg) document.body.prepend(svg);
      })
      .catch(() => {
        /* optional enhancement */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
