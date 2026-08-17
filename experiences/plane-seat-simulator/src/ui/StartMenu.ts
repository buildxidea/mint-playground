/**
 * Full-screen title card. The backdrop is the live cabin behind it, blurred
 * down by a class on the container, so the menu always shows the real thing
 * rather than a screenshot that would drift out of date. Dismissing it lifts
 * the blur, which pulls focus into the cabin as the card fades.
 */
export class StartMenu {
  private root: HTMLDivElement;
  private button: HTMLButtonElement;
  private done = false;

  constructor(
    private container: HTMLElement,
    private onStart: () => void,
    private onDismiss: () => void,
  ) {
    container.classList.add("menu-open");

    this.root = document.createElement("div");
    this.root.id = "start-menu";

    const scrim = document.createElement("div");
    scrim.className = "start-scrim";
    this.root.appendChild(scrim);

    const content = document.createElement("div");
    content.className = "start-content";
    content.innerHTML = `
      <h1 class="start-title">Plane Seat Simulator</h1>
      <p class="start-tagline">Find out where you're sitting before you fly</p>
    `;

    this.button = document.createElement("button");
    this.button.className = "start-btn";
    this.button.innerHTML = `<span>Start</span>`;
    this.button.addEventListener("click", () => this.start());
    content.appendChild(this.button);

    this.root.appendChild(content);
    container.appendChild(this.root);

    requestAnimationFrame(() => this.button.focus());
    window.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.done) return;
    if (e.code === "Enter" || e.code === "Space") {
      e.preventDefault();
      this.start();
    }
  };

  private start() {
    if (this.done) return;
    this.close();
    this.onStart();
  }

  /**
   * Takes the card down without triggering the Start action. Picking a seat
   * from the map on the landing page uses this: the pick is already going
   * somewhere, so handing over to the overview on top of it would fight it.
   */
  close() {
    if (this.done) return;
    this.done = true;
    window.removeEventListener("keydown", this.onKey);
    this.container.classList.remove("menu-open");
    this.root.classList.add("leaving");
    this.onDismiss();
    this.root.addEventListener("transitionend", () => this.root.remove(), {
      once: true,
    });
  }

  dispose() {
    window.removeEventListener("keydown", this.onKey);
    this.container.classList.remove("menu-open");
    this.root.remove();
  }
}
