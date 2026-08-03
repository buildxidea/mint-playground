export interface Score {
  /** Call when a poke actually lands on him. Returns the points awarded. */
  registerPoke(): number;
  /** Float a "+N" up from where the poke landed, in client coordinates. */
  showGain(clientX: number, clientY: number, amount: number): void;
  update(dt: number): void;
}

/** Poke again within this many seconds to keep the chain alive. */
const COMBO_WINDOW = 0.9;
/** Consecutive pokes needed to climb one multiplier step. */
const POKES_PER_STEP = 3;
const MAX_MULTIPLIER = 8;

// Spring for the number's punch. Damping ratio lands near 0.3 — high enough to
// settle in well under a second, low enough that it visibly springs past rest
// on the way back instead of easing flatly into it.
const SPRING_STIFFNESS = 220;
const SPRING_DAMPING = 9;

/**
 * Score counter with a rapid-poke combo multiplier.
 *
 * The number springs on every poke and the multiplier chip fades out as the
 * combo window runs down, so you can see the chain about to lapse without a
 * separate meter.
 */
export function createScore(root: HTMLElement): Score {
  const wrap = document.createElement("div");
  wrap.className = "score";

  const label = document.createElement("div");
  label.className = "score-label";
  label.textContent = "SCORE";

  const row = document.createElement("div");
  row.className = "score-row";

  const value = document.createElement("div");
  value.className = "score-value";
  value.textContent = "0";

  const multiplier = document.createElement("div");
  multiplier.className = "score-multiplier";
  multiplier.textContent = "";

  row.append(value, multiplier);
  wrap.append(label, row);
  root.append(wrap);

  let total = 0;
  let chain = 0;
  let sinceLastPoke = Infinity;
  let scale = 1;
  let scaleVelocity = 0;
  let shownMultiplier = 1;

  function currentMultiplier() {
    if (chain === 0) return 1;
    return Math.min(1 + Math.floor((chain - 1) / POKES_PER_STEP), MAX_MULTIPLIER);
  }

  return {
    registerPoke() {
      chain = sinceLastPoke <= COMBO_WINDOW ? chain + 1 : 1;
      sinceLastPoke = 0;

      const gained = currentMultiplier();
      total += gained;
      value.textContent = String(total);

      // Punch harder the higher the multiplier, so a long chain feels earned.
      // Assigned rather than accumulated: stacking impulses during a fast chain
      // pins the number at its size clamp and it stops visibly springing back.
      scaleVelocity = 8.4 + gained * 0.35;
      return gained;
    },
    showGain(clientX, clientY, amount) {
      // Proves the spot you hit scored, wherever on him it was.
      const gain = document.createElement("div");
      gain.className = "score-gain";
      gain.textContent = `+${amount}`;
      gain.style.left = `${clientX}px`;
      gain.style.top = `${clientY}px`;
      if (amount > 1) {
        const hue = 205 - (amount - 1) * 26;
        gain.style.color = `hsl(${Math.max(hue, 5)}, 78%, 48%)`;
      }
      document.body.append(gain);
      gain.addEventListener("animationend", () => gain.remove(), { once: true });
      // Backstop: animations do not run in a hidden tab, so animationend may
      // never fire and these would accumulate.
      setTimeout(() => gain.remove(), 2000);
    },
    update(dt: number) {
      sinceLastPoke += dt;
      if (sinceLastPoke > COMBO_WINDOW) chain = 0;

      const mult = currentMultiplier();
      if (mult !== shownMultiplier) {
        shownMultiplier = mult;
        multiplier.textContent = mult > 1 ? `×${mult}` : "";
        // Warmer and hotter as the chain climbs: calm blue → amber → red.
        const hue = 205 - (mult - 1) * 26;
        multiplier.style.color = `hsl(${Math.max(hue, 5)}, 78%, 52%)`;
        if (mult > 1) {
          // Re-trigger the chip's pop by restarting its animation.
          multiplier.classList.remove("bump");
          void multiplier.offsetWidth;
          multiplier.classList.add("bump");
        }
      }

      // Fade the chip out across the window so a lapsing combo is visible.
      if (mult > 1) {
        const left = Math.max(0, 1 - sinceLastPoke / COMBO_WINDOW);
        multiplier.style.opacity = String(0.35 + 0.65 * left);
      }

      // Damped spring back to rest.
      scaleVelocity += (-SPRING_STIFFNESS * (scale - 1) - SPRING_DAMPING * scaleVelocity) * dt;
      scale += scaleVelocity * dt;
      scale = Math.min(Math.max(scale, 0.85), 1.9);
      value.style.transform = `scale(${scale.toFixed(3)})`;
    },
  };
}
