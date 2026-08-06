/**
 * The controls button.
 *
 * `H` already opens the controls card, but that is only discoverable from the
 * card itself — which a pilot dismisses on their first keypress and then has
 * no visible way back to. This is the way back: always on screen, top right,
 * clear of the HUD strip and the mute button at the bottom.
 */
export class ControlsButton {
  readonly button: HTMLButtonElement;

  constructor(container: HTMLElement, onToggle: () => void) {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "controls-btn";
    this.button.title = "Show the controls (H)";
    this.button.textContent = "Controls";
    this.button.addEventListener("click", () => onToggle());
    container.appendChild(this.button);
  }

  dispose() {
    this.button.remove();
  }
}
