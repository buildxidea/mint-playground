/** Sticky top bar: boxed mark, centered nav, right-hand actions. */
export class Topbar {
  constructor(root: HTMLElement) {
    root.innerHTML = "";

    const mark = document.createElement("a");
    mark.className = "mark";
    mark.href = "#stage";
    mark.setAttribute("aria-label", "Battle Blaster home");
    mark.innerHTML = `<span class="mark-glyph" aria-hidden="true"></span><span class="mark-word">Battle Blaster</span>`;

    const nav = document.createElement("nav");
    nav.className = "topnav";
    nav.setAttribute("aria-label", "Primary");
    for (const [label, href] of [
      ["Arsenal", "#rail"],
      ["Configure", "#spec"],
      ["Notes", "#notes"],
    ] as const) {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      nav.appendChild(link);
    }

    const actions = document.createElement("div");
    actions.className = "topactions";
    const notes = document.createElement("a");
    notes.className = "ghost-button";
    notes.href = "#notes";
    notes.textContent = "Field notes";
    actions.appendChild(notes);

    root.append(mark, nav, actions);
  }
}
