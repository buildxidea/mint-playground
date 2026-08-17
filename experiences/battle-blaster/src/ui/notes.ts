const ENTRIES = [
  {
    title: "Coil stack",
    body: "Copper windings around the emitter throat set how far the bolt carries before it blooms.",
  },
  {
    title: "Cell seating",
    body: "Every frame exposes its plasma cell. Swapping the feed trades handling for cycle speed.",
  },
  {
    title: "Module bays",
    body: "Five bay types across the line, but no frame takes all five. Fit is part of the design.",
  },
];

/** Scrolling section below the stage: eyebrow, display heading, 3 detail notes. */
export class Notes {
  constructor(root: HTMLElement) {
    root.innerHTML = "";

    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Field notes / BB series";

    const heading = document.createElement("h2");
    heading.className = "display";
    heading.textContent = "Built to be taken apart.";

    const grid = document.createElement("div");
    grid.className = "notes-grid";
    ENTRIES.forEach((entry, index) => {
      const article = document.createElement("article");
      article.className = "note";
      article.innerHTML =
        `<p class="eyebrow">Detail ${String(index + 1).padStart(2, "0")}</p>` +
        `<h3 class="note-title"></h3>` +
        `<p class="note-body"></p>`;
      article.querySelector<HTMLElement>(".note-title")!.textContent = entry.title;
      article.querySelector<HTMLElement>(".note-body")!.textContent = entry.body;
      grid.appendChild(article);
    });

    root.append(eyebrow, heading, grid);
  }
}
