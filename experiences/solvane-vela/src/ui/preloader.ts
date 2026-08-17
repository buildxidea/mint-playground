const LABELS = [
  "Opening the archive…",
  "Rolling out 1948…",
  "Polishing the chrome…",
  "Charging the neon…",
  "Warming the studio…",
  "Eighty years, one room…",
];

export function createPreloader() {
  const root = document.getElementById("preloader")!;
  const fill = document.getElementById("preloader-fill")!;
  const label = document.getElementById("preloader-label")!;

  return {
    progress(loaded: number, total: number) {
      const p = total > 0 ? loaded / total : 0;
      fill.style.width = `${Math.round(p * 100)}%`;
      label.textContent = LABELS[Math.min(LABELS.length - 1, loaded)];
    },
    done() {
      fill.style.width = "100%";
      root.classList.add("is-done");
      setTimeout(() => root.remove(), 1200);
    },
    error(message: string) {
      root.classList.add("is-error");
      label.textContent = message;
    },
  };
}
