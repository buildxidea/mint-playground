/**
 * The mute button.
 *
 * `N` already toggles audio, but a keybind with no visible control is not
 * discoverable — someone who has not opened the controls card has no way to
 * know sound exists, let alone how to silence it. This is the on-screen
 * equivalent, kept in sync with the same state the key drives.
 */
export class MuteButton {
  readonly button: HTMLButtonElement;

  constructor(
    container: HTMLElement,
    private readonly onToggle: () => void,
  ) {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "mute-btn";
    this.button.setAttribute("aria-pressed", "false");
    this.button.title = "Mute rotor audio (N)";
    this.button.addEventListener("click", () => this.onToggle());

    container.appendChild(this.button);
    this.render(false);
  }

  /** Reflect the current mute state. Cheap; call whenever it may have changed. */
  render(muted: boolean) {
    this.button.textContent = muted ? "🔇" : "🔊";
    this.button.setAttribute("aria-pressed", String(muted));
    this.button.classList.toggle("is-muted", muted);
  }
}
