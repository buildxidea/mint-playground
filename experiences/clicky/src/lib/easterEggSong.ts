/**
 * Live heyclicky.com easter-egg songs: hold (pointerdown) fades in,
 * release fades out. Skipped on narrow viewports like the source site.
 */
export function attachEasterEggSong(
  el: HTMLElement,
  songFile: string,
  startSec: number,
): () => void {
  if (window.matchMedia("(max-width: 1023px)").matches) {
    return () => {};
  }

  const ac = new AbortController();
  let audio: HTMLAudioElement | null = null;
  let fadeRaf = 0;

  const fadeTo = (target: number) => {
    if (!audio) return;
    cancelAnimationFrame(fadeRaf);
    const duration = target === 0 ? 600 : 1500;
    const from = audio.volume;
    const t0 = performance.now();
    const step = (now: number) => {
      if (!audio) return;
      const t = Math.max(0, Math.min(1, (now - t0) / duration));
      const eased = from + t * (2 - t) * (target - from);
      audio.volume = Math.max(0, Math.min(1, eased));
      if (t < 1) fadeRaf = requestAnimationFrame(step);
      else if (target === 0) audio.pause();
    };
    fadeRaf = requestAnimationFrame(step);
  };

  el.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (!audio) {
        audio = new Audio(`/assets/${songFile}`);
        audio.loop = true;
        audio.volume = 0;
        const seek = () => {
          try {
            if (audio) audio.currentTime = startSec;
          } catch {
            /* ignore */
          }
        };
        if (audio.readyState >= 1) seek();
        else audio.addEventListener("loadedmetadata", seek, { once: true });
        document.body.appendChild(audio);
      }
      void audio.play().catch(() => {});
      fadeTo(0.5);
    },
    { signal: ac.signal },
  );

  for (const type of ["pointerup", "pointercancel"] as const) {
    window.addEventListener(
      type,
      () => {
        if (audio && !audio.paused) fadeTo(0);
      },
      { signal: ac.signal },
    );
  }

  return () => {
    ac.abort();
    cancelAnimationFrame(fadeRaf);
    audio?.pause();
    audio?.remove();
    audio = null;
  };
}
