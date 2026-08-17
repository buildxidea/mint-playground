import { audio } from "../audio/audio-manager";
import type { AppState, ViewToggle } from "../app/state";

export interface ToolbarActions {
  reset(): void;
}

type ToolKey = ViewToggle | "sound";

const TOOLS: { key: ToolKey; label: string; glyph: string }[] = [
  { key: "lift", label: "Lift", glyph: "↑" },
  { key: "explode", label: "Explode", glyph: "⤢" },
  { key: "compare", label: "Compare", glyph: "⇄" },
  { key: "sound", label: "Sound", glyph: "♪" },
];

/** Bottom-centre tool bar floating over the stage. */
export class Toolbar {
  private buttons = new Map<ToolKey, HTMLButtonElement>();

  constructor(root: HTMLElement, private state: AppState, actions: ToolbarActions) {
    const bar = document.createElement("div");
    bar.className = "toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Stage controls");

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "tool";
    reset.innerHTML = `<span class="tool-glyph" aria-hidden="true">⟲</span><span>Reset</span>`;
    reset.addEventListener("click", actions.reset);
    bar.appendChild(reset);

    for (const tool of TOOLS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool";
      button.innerHTML =
        `<span class="tool-glyph" aria-hidden="true">${tool.glyph}</span><span>${tool.label}</span>`;
      button.addEventListener("click", () => {
        if (tool.key === "sound") {
          // AudioManager owns mute; the bar just reflects it.
          audio.setEnabled(!audio.enabled);
          this.refresh();
        } else {
          this.state.setToggle(tool.key, !this.state.isOn(tool.key));
        }
      });
      this.buttons.set(tool.key, button);
      bar.appendChild(button);
    }

    root.appendChild(bar);
    this.refresh();
  }

  refresh(): void {
    for (const [key, button] of this.buttons) {
      const on = key === "sound" ? audio.enabled : this.state.isOn(key);
      button.setAttribute("aria-pressed", String(on));
    }
  }
}
