import { BRAND, ERAS, type Era } from "../brand/brand";
import { ERA_MARKS, MASTER_MARK } from "../brand/logos";
import { isSingleMesh } from "../scene/fleet-manifest";

/** Build hero, six era chapters, finale, and footer into #content. */
export function buildSections() {
  const content = document.getElementById("content")!;

  content.insertAdjacentHTML("beforeend", heroHtml());
  ERAS.forEach((era) => content.insertAdjacentHTML("beforeend", chapterHtml(era)));
  content.insertAdjacentHTML("beforeend", finaleHtml());
  content.insertAdjacentHTML("beforeend", footerHtml());

  // nav links + marks
  document.getElementById("nav-mark")!.innerHTML = MASTER_MARK;
  document.getElementById("preloader-mark")!.innerHTML = MASTER_MARK;
  const nav = document.getElementById("nav-links")!;
  nav.innerHTML = ERAS.map(
    (e) => `<a href="#ch-${e.key}" data-era="${e.index}">${e.year}</a>`,
  ).join("");
}

function heroHtml() {
  return `
  <section class="chapter hero" id="ch-hero" aria-label="Introduction">
    <div class="chapter__pin">
      <div class="chapter__inner">
        <p class="kicker reveal">${BRAND.name} · est. ${BRAND.founded} · ${BRAND.town}</p>
        <h1 class="hero__title reveal r2">${BRAND.heroTagline}</h1>
        <p class="deck hero__sub reveal r3">${BRAND.heroSub}</p>
        <p class="hero__scroll">Scroll to enter</p>
        <div class="hero__years" aria-hidden="true">
          ${ERAS.map((e) => `<span>${e.year}</span>`).join("")}
        </div>
      </div>
    </div>
  </section>`;
}

function chapterHtml(era: Era) {
  // A single-mesh car has no panels to open or take apart. Every era ships as
  // one mesh today, so the toolbar is empty and omitted entirely — but a
  // future part-pack era would bring its buttons back automatically.
  const tools = isSingleMesh(era.key)
    ? ""
    : `<button class="tool-btn" data-action="doors" data-era="${era.key}">Open doors</button>` +
      `<button class="tool-btn" data-action="explode" data-era="${era.key}">Explode</button>`;

  const customizer = era.key === "car-2026" ? customizerHtml(era.key) : "";

  return `
  <section class="chapter chapter--${era.key}" id="ch-${era.key}" aria-label="${era.year} — ${era.model}">
    <div class="chapter__pin">
      <div class="chapter__inner">
        <div class="chapter__copy">
          <p class="kicker reveal">Chapter ${era.chapter} — ${era.year}</p>
          <h2 class="headline reveal r2">${era.model}</h2>
          <p class="deck reveal r3">${era.positioning}</p>
          <ul class="specs reveal r4">
            ${era.specs.map((s) => `<li><span class="label">${s.label}</span><span class="value">${s.value}</span></li>`).join("")}
          </ul>
          ${customizer}
        </div>
        <aside class="adcard reveal r3" aria-label="Period advertisement (fictional)">
          <div class="adcard__mark">${ERA_MARKS[era.key]}</div>
          <h3>${era.adHeadline}</h3>
          <p>${era.adBody}</p>
          ${era.adFootnote ? `<p class="footnote">${era.adFootnote}</p>` : ""}
        </aside>
        ${tools ? `<div class="chapter__tools reveal r4">${tools}</div>` : ""}
      </div>
    </div>
  </section>`;
}

function customizerHtml(eraKey: string) {
  // a single-mesh car has no separately addressable wheels to finish
  const wheels = isSingleMesh(eraKey)
    ? ""
    : `
    <div>
      <h4>Wheels</h4>
      <div class="row" id="wheel-row" role="radiogroup" aria-label="Wheel finish"></div>
    </div>`;
  return `
  <div class="customizer reveal r4" id="customizer">
    <div>
      <h4>Paint</h4>
      <div class="row" id="paint-row" role="radiogroup" aria-label="Paint color"></div>
    </div>${wheels}
  </div>`;
}

function finaleHtml() {
  return `
  <section class="chapter finale" id="ch-finale" aria-label="All generations">
    <div class="chapter__pin">
      <div class="chapter__inner">
        <div class="finale__head">
          <p class="kicker reveal">Chapter 07 — The lineage</p>
          <h2 class="headline reveal r2">${BRAND.finaleHeadline}</h2>
          <p class="deck reveal r3">${BRAND.finaleSub}</p>
        </div>
        <div class="finale__lineup reveal r4" aria-hidden="true">
          ${ERAS.map((e) => `<div class="finale__slot"><strong>${e.model}</strong><span>${e.year}</span></div>`).join("")}
        </div>
      </div>
    </div>
  </section>`;
}

function footerHtml() {
  return `
  <footer class="site-footer">
    <div>
      <h4>${BRAND.name}</h4>
      <p class="colophon">
        ${BRAND.name} is a fictional marque created for this study. Every model,
        specification, advertisement, and year of history on this page is
        invented. One car, eighty years, one room.
      </p>
    </div>
    <div>
      <h4>Generations</h4>
      <ul>
        ${ERAS.map((e) => `<li><a href="#ch-${e.key}">${e.year} — ${e.model}</a></li>`).join("")}
      </ul>
    </div>
    <div>
      <h4>Study</h4>
      <ul>
        <li><a href="#ch-hero">Top</a></li>
        <li><a href="#ch-finale">The lineage</a></li>
      </ul>
    </div>
    <p class="legal">© ${new Date().getFullYear()} ${BRAND.name} — a fictional brand · WebGL · no trackers</p>
  </footer>`;
}
