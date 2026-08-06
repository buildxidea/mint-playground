import { CONTROL_GROUPS } from "../input/bindings";

/**
 * The controls card.
 *
 * Shown on load, because a flight sandbox with no visible instructions and an
 * aircraft that spawns disarmed is indistinguishable from a broken page. Any
 * key or click dismisses it — a pilot who already knows the scheme should not
 * have to hunt for a close button — and `H` brings it back.
 */
export class HelpCard {
  private readonly root: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "help";

    const card = document.createElement("div");
    card.className = "help-card";

    const heading = document.createElement("p");
    heading.className = "help-heading";
    heading.textContent = "Press Enter to arm, then hold W";
    card.appendChild(heading);

    const groups = document.createElement("div");
    groups.className = "help-groups";
    for (const group of CONTROL_GROUPS) {
      const section = document.createElement("section");

      const title = document.createElement("h2");
      title.textContent = group.title;
      section.appendChild(title);

      const list = document.createElement("dl");
      for (const [key, action] of group.items) {
        const term = document.createElement("dt");
        term.textContent = key;
        const description = document.createElement("dd");
        description.textContent = action;
        list.append(term, description);
      }
      section.appendChild(list);
      groups.appendChild(section);
    }
    card.appendChild(groups);

    const dismiss = document.createElement("p");
    dismiss.className = "help-dismiss";
    dismiss.textContent = "Any key to dismiss · H to reopen";
    card.appendChild(dismiss);

    this.root.appendChild(card);
    container.appendChild(this.root);
  }

  get visible() {
    return !this.root.hidden;
  }

  show() {
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
  }
}
