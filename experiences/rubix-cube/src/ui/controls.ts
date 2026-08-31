import { BackgroundName, CUBE_SIZES, CubeSize } from "../cube/constants";

/**
 * One compact bar, bottom centred, and nothing else.
 *
 * Everything that is not a primary action lives behind a button that opens a
 * small anchored popover, so the bar stays a single row and the cube stays
 * unobstructed. During playback the action buttons are swapped out for the
 * transport controls in place rather than adding a second row.
 */

export interface HudCallbacks {
  onScramble(): void;
  onSolve(): void;
  onUndo(): void;
  onReset(): void;
  onPlayToggle(): void;
  onStepForward(): void;
  onStepBack(): void;
  onSpeedChange(msPerMove: number): void;
  onBackgroundChange(value: BackgroundName): void;
  onSizeChange(value: CubeSize): void;
  onMuteToggle(): void;
}

export interface HudState {
  status: string;
  busy: boolean;
  canUndo: boolean;
  size: CubeSize;
  canSolve: boolean;
  solveHint: string;
  muted: boolean;
  /** Deepest inner layer the current cube has, for the key list. */
  maxDepth: number;
  playback: {
    visible: boolean;
    playing: boolean;
    position: number;
    length: number;
    /** Just the move about to play, e.g. "R'". */
    current: string;
  };
}

const SPEED_MIN = 45;
const SPEED_MAX = 600;

function keyRows(maxDepth: number): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Drag cube", "Turn that layer"],
    ["Drag background", "Orbit the view"],
    ["Scroll / pinch", "Zoom"],
    ["U D L R F B", "Turn that face"],
    ["Shift + letter", "Turn it the other way"],
  ];
  // Inner layers only exist from 3x3 up, so only offer the keys that do
  // something on the cube currently loaded.
  if (maxDepth >= 2) {
    rows.push([
      `2…${maxDepth} then a face`,
      "Turn that layer in from the face",
    ]);
  }
  rows.push(["Space", "Scramble"]);
  return rows;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly actionsEl: HTMLDivElement;
  private readonly transportEl: HTMLDivElement;

  private readonly sizeButton: HTMLButtonElement;
  private readonly muteButton: HTMLButtonElement;
  private readonly solveButton: HTMLButtonElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly playButton: HTMLButtonElement;
  private readonly counterEl: HTMLSpanElement;
  private readonly moveEl: HTMLSpanElement;
  private readonly actionButtons: HTMLButtonElement[] = [];

  private readonly popovers: HTMLDivElement[] = [];
  private readonly sizePanel: HTMLDivElement;
  private readonly keysPanel: HTMLDivElement;
  private readonly settingsPanel: HTMLDivElement;
  private readonly sizeOptions = new Map<CubeSize, HTMLButtonElement>();
  private keysDepth = -1;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: HudCallbacks,
    initialBackground: BackgroundName,
    initialSize: CubeSize,
  ) {
    this.root = document.createElement("div");
    this.root.className = "hud";

    this.statusEl = document.createElement("div");
    this.statusEl.className = "status";

    this.bar = document.createElement("div");
    this.bar.className = "bar";

    /* ------------------------------------------------------- size button */

    this.sizeButton = button(sizeLabel(initialSize), "Cube size", () =>
      this.toggle(this.sizePanel),
    );
    this.sizeButton.classList.add("size");

    /* ---------------------------------------------------------- actions */

    this.actionsEl = document.createElement("div");
    this.actionsEl.className = "seg";

    const scramble = button("Scramble", "Scramble the cube", () =>
      callbacks.onScramble(),
    );
    this.solveButton = button("Solve", "Solve the cube", () =>
      callbacks.onSolve(),
    );
    this.undoButton = button("Undo", "Undo the last turn", () =>
      callbacks.onUndo(),
    );
    const reset = button("Reset", "Return to solved", () =>
      callbacks.onReset(),
    );
    this.actionButtons.push(scramble, this.solveButton, this.undoButton, reset);
    this.actionsEl.append(scramble, this.solveButton, this.undoButton, reset);

    /* -------------------------------------------------------- transport */

    this.transportEl = document.createElement("div");
    this.transportEl.className = "seg";
    this.transportEl.hidden = true;

    const stepBack = button("‹", "Step back", () => callbacks.onStepBack());
    this.playButton = button("❚❚", "Play or pause", () =>
      callbacks.onPlayToggle(),
    );
    const stepForward = button("›", "Step forward", () =>
      callbacks.onStepForward(),
    );

    this.moveEl = document.createElement("span");
    this.moveEl.className = "move";

    this.counterEl = document.createElement("span");
    this.counterEl.className = "counter";

    const speed = document.createElement("input");
    speed.type = "range";
    speed.className = "speed";
    speed.min = String(SPEED_MIN);
    speed.max = String(SPEED_MAX);
    speed.value = "180";
    speed.title = "Speed";
    // The slider reads left-to-right as slow-to-fast, so invert the duration.
    speed.addEventListener("input", () => {
      callbacks.onSpeedChange(SPEED_MIN + SPEED_MAX - Number(speed.value));
    });

    this.transportEl.append(
      stepBack,
      this.playButton,
      stepForward,
      this.moveEl,
      this.counterEl,
      speed,
    );

    /* ------------------------------------------------------------ icons */

    this.muteButton = button("", "Mute turn sound", () =>
      callbacks.onMuteToggle(),
    );
    this.muteButton.classList.add("icon");

    const keys = button("⌨", "Controls", () => this.toggle(this.keysPanel));
    keys.classList.add("icon");
    const settings = button("⚙", "Settings", () =>
      this.toggle(this.settingsPanel),
    );
    settings.classList.add("icon");

    const icons = document.createElement("div");
    icons.className = "seg";
    icons.append(this.muteButton, keys, settings);

    this.bar.append(
      this.sizeButton,
      divider(),
      this.actionsEl,
      this.transportEl,
      divider(),
      icons,
    );

    /* --------------------------------------------------------- popovers */

    this.sizePanel = this.buildSizePanel(initialSize);
    this.keysPanel = this.buildKeysPanel();
    this.settingsPanel = this.buildSettingsPanel(initialBackground);

    this.root.append(
      this.statusEl,
      this.bar,
      this.sizePanel,
      this.keysPanel,
      this.settingsPanel,
    );
    parent.append(this.root);

    document.addEventListener("pointerdown", (event) => {
      if (!this.root.contains(event.target as Node)) this.closeAll();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.closeAll();
    });
  }

  private register(panel: HTMLDivElement): HTMLDivElement {
    panel.hidden = true;
    this.popovers.push(panel);
    return panel;
  }

  /** Only ever one popover open, so they can never stack over the cube. */
  private toggle(panel: HTMLDivElement): void {
    const wasOpen = !panel.hidden;
    this.closeAll();
    panel.hidden = wasOpen;
  }

  private closeAll(): void {
    for (const panel of this.popovers) panel.hidden = true;
  }

  private buildSizePanel(initial: CubeSize): HTMLDivElement {
    const panel = document.createElement("div");
    panel.className = "pop pop-left";

    for (const size of CUBE_SIZES) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "row";
      option.textContent = sizeLabel(size);
      option.classList.toggle("on", size === initial);
      option.addEventListener("click", () => {
        this.closeAll();
        this.callbacks.onSizeChange(size);
      });
      this.sizeOptions.set(size, option);
      panel.append(option);
    }

    return this.register(panel);
  }

  private buildKeysPanel(): HTMLDivElement {
    const panel = document.createElement("div");
    panel.className = "pop pop-right keys";
    return this.register(panel);
  }

  /** Rebuilt on size change so it never lists keys that do nothing. */
  private fillKeysPanel(maxDepth: number): void {
    if (this.keysDepth === maxDepth) return;
    this.keysDepth = maxDepth;
    this.keysPanel.replaceChildren();
    for (const [key, what] of keyRows(maxDepth)) {
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      const text = document.createElement("span");
      text.textContent = what;
      this.keysPanel.append(kbd, text);
    }
  }

  private buildSettingsPanel(initial: BackgroundName): HTMLDivElement {
    const panel = document.createElement("div");
    panel.className = "pop pop-right";

    const label = document.createElement("div");
    label.className = "pop-label";
    label.textContent = "Background";

    const options = document.createElement("div");
    options.className = "choices";

    for (const value of ["black", "white"] as BackgroundName[]) {
      const option = document.createElement("button");
      option.type = "button";
      option.textContent = value === "black" ? "Black" : "White";
      option.classList.toggle("on", value === initial);
      option.addEventListener("click", () => {
        options.querySelectorAll("button").forEach((b) => {
          b.classList.toggle("on", b === option);
        });
        this.callbacks.onBackgroundChange(value);
      });
      options.append(option);
    }

    panel.append(label, options);
    return this.register(panel);
  }

  update(state: HudState): void {
    this.statusEl.textContent = state.status;
    this.fillKeysPanel(state.maxDepth);

    this.muteButton.innerHTML = state.muted ? SPEAKER_OFF : SPEAKER_ON;
    this.muteButton.title = state.muted ? "Unmute turn sound" : "Mute turn sound";
    this.muteButton.setAttribute("aria-pressed", String(state.muted));
    this.muteButton.classList.toggle("muted", state.muted);
    this.statusEl.classList.toggle("empty", state.status.length === 0);

    this.sizeButton.textContent = sizeLabel(state.size);
    this.sizeButton.disabled = state.busy;
    for (const [size, option] of this.sizeOptions) {
      option.classList.toggle("on", size === state.size);
    }

    for (const b of this.actionButtons) b.disabled = state.busy;
    this.undoButton.disabled = state.busy || !state.canUndo;

    // A size with no solver disables Solve and says why, rather than
    // offering a button that fails.
    this.solveButton.disabled = state.busy || !state.canSolve;
    this.solveButton.title = state.canSolve ? "Solve the cube" : state.solveHint;

    // Transport replaces the actions in place - never a second row.
    this.actionsEl.hidden = state.playback.visible;
    this.transportEl.hidden = !state.playback.visible;

    if (state.playback.visible) {
      this.playButton.textContent = state.playback.playing ? "❚❚" : "▶";
      this.counterEl.textContent = `${state.playback.position}/${state.playback.length}`;
      this.moveEl.textContent = state.playback.current;
    }
  }
}

function button(
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.title = title;
  el.addEventListener("click", onClick);
  return el;
}

function divider(): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "div";
  return el;
}

const SPEAKER_BODY = '<path d="M7.4 2.6 4.1 5.6H2v4.8h2.1l3.3 3z"/>';

const SPEAKER_ON =
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ` +
  `stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">` +
  SPEAKER_BODY +
  '<path d="M10.4 6.1a2.7 2.7 0 0 1 0 3.8"/>' +
  '<path d="M12.4 4.2a5.4 5.4 0 0 1 0 7.6"/>' +
  "</svg>";

const SPEAKER_OFF =
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ` +
  `stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">` +
  SPEAKER_BODY +
  '<path d="M10.6 6.2 14 9.8"/><path d="M14 6.2l-3.4 3.6"/>' +
  "</svg>";

function sizeLabel(size: CubeSize): string {
  return `${size}×${size}`;
}
