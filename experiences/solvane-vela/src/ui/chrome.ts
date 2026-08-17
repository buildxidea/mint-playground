import { ERAS } from "../brand/brand";
import { ERA_PAGE_BG } from "../scene/EraGrades";
import type { ScrollTimeline } from "../scroll/ScrollTimeline";

/** Chapter rail, nav active state, era switcher, page background sync. */
export function buildChrome(timeline: ScrollTimeline) {
  const rail = document.getElementById("rail")!;
  rail.innerHTML = ERAS.map(
    (e, i) => `
    <button class="rail__item" data-era="${i}" aria-label="Go to ${e.year} ${e.model}">
      <span>${e.chapter}</span><span class="rail__year">${e.year}</span>
    </button>`,
  ).join("");

  const switcher = document.createElement("div");
  switcher.className = "switcher";
  switcher.setAttribute("role", "tablist");
  switcher.setAttribute("aria-label", "Generation switcher");
  switcher.innerHTML = ERAS.map(
    (e, i) => `<button role="tab" data-era="${i}" aria-label="${e.model}">${e.year}</button>`,
  ).join("");
  document.body.appendChild(switcher);

  const jump = (i: number) => timeline.scrollToEra(i);
  rail.querySelectorAll<HTMLButtonElement>(".rail__item").forEach((b) =>
    b.addEventListener("click", () => jump(Number(b.dataset.era))),
  );
  switcher.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
    b.addEventListener("click", () => jump(Number(b.dataset.era))),
  );
  document.querySelectorAll<HTMLAnchorElement>("#nav-links a").forEach((a) =>
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      jump(Number(a.dataset.era));
    }),
  );

  timeline.onChange((s) => {
    const i = Math.min(ERAS.length - 1, Math.max(0, s.activeIndex));
    rail.querySelectorAll(".rail__item").forEach((el, k) =>
      el.classList.toggle("is-active", k === i && s.activeIndex >= 0),
    );
    switcher.querySelectorAll("button").forEach((el, k) =>
      el.classList.toggle("is-active", k === i && s.activeIndex >= 0),
    );
    document.querySelectorAll("#nav-links a").forEach((el, k) =>
      el.classList.toggle("is-active", k === i && s.activeIndex >= 0),
    );
    switcher.classList.toggle(
      "is-visible",
      s.activeIndex >= 0 && s.activeIndex < ERAS.length,
    );

    // page background follows the era so DOM chrome blends with the stage
    const idx = Math.round(Math.min(ERAS.length - 1, Math.max(0, s.eraFloat)));
    document.body.style.background = ERA_PAGE_BG[idx];
  });
}
