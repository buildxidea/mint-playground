/**
 * Every key the sandbox reads, in one table so the whole scheme can be
 * rebound — and so a gamepad mapping can be added later without hunting
 * through event handlers.
 *
 * The default layout mirrors a Mode 2 transmitter: left hand flies throttle
 * and yaw, right hand flies pitch and roll.
 */
export interface Bindings {
  throttleUp: string[];
  throttleDown: string[];
  yawLeft: string[];
  yawRight: string[];
  pitchUp: string[];
  pitchDown: string[];
  rollLeft: string[];
  rollRight: string[];
  arm: string[];
  cycleMode: string[];
  reset: string[];
}

export const DEFAULT_BINDINGS: Bindings = {
  throttleUp: ["KeyW"],
  throttleDown: ["KeyS"],
  yawLeft: ["KeyA"],
  yawRight: ["KeyD"],
  pitchUp: ["ArrowDown"],
  pitchDown: ["ArrowUp"],
  rollLeft: ["ArrowLeft"],
  rollRight: ["ArrowRight"],
  arm: ["Enter"],
  cycleMode: ["KeyM"],
  reset: ["KeyR"],
};

export interface ControlGroup {
  title: string;
  items: ReadonlyArray<[key: string, action: string]>;
}

/**
 * The on-screen control reference.
 *
 * Grouped, and ordered so the two keys a new pilot needs — arm, then throttle —
 * come first. `test/bindings.test.ts` asserts every key the app handles appears
 * here, because this table previously existed while being rendered nowhere.
 */
export const CONTROL_GROUPS: ReadonlyArray<ControlGroup> = [
  {
    title: "Flying",
    items: [
      ["Enter", "Arm / disarm — start here"],
      ["X", "Tap to cycle craft, hold to open the chooser"],
      ["W / S", "Throttle up / down"],
      ["↑ / ↓", "Pitch nose down / up (plane: elevator)"],
      ["← / →", "Roll left / right (plane: ailerons)"],
      ["A / D", "Yaw left / right (plane: rudder)"],
      ["M", "Quad flight mode — position / acro / stabilized"],
      ["R", "Reset to the pad / runway"],
    ],
  },
  {
    title: "Choosing a craft",
    items: [
      ["hold X", "Show every craft at once"],
      ["↑ ↓ ← →", "Move the highlight — or just use the mouse"],
      ["Enter / Space", "Fly the highlighted craft"],
      ["Esc", "Close without changing craft"],
    ],
  },
  {
    // A rocket is flown as a sequence, not as a set of controls, so its keys
    // are listed in the order you press them rather than scattered above.
    title: "Rocket — launch sequence",
    items: [
      ["1.  Enter", "Ignition — the stack lifts when thrust beats its weight"],
      ["2.  W", "Full throttle. The solid boosters ignore it and burn flat out"],
      ["3.  ↑ ↓ ← →", "Tilt over. The engines gimbal, so steering needs thrust"],
      ["4.  Z", "Drop the boosters once they burn out — watch the Prop readout"],
      ["  A / D", "Yaw. Roll on ← → is the only control that survives shutdown"],
      ["  S", "Throttle back. At zero you have no steering at all"],
      ["  K", "Engine plumes on / off"],
    ],
  },
  {
    title: "View",
    items: [
      ["C", "Camera — chase / onboard / orbit / ground"],
      ["G", "Onboard horizon — locked to aircraft or level"],
      ["U", "Motion trail"],
      ["B", "Ambient occlusion"],
      ["N", "Mute rotor audio"],
    ],
  },
  {
    title: "Instruments",
    items: [
      ["T", "Gain tuning panel"],
      ["P", "Rate-loop plots"],
      ["1 / 2 / 3", "Tune — stable / sport / detuned"],
      ["L", "Lidar sweep"],
      ["O", "Occupancy map"],
      ["[ / ]", "Wind speed down / up"],
      ["H", "Show these controls"],
    ],
  },
];
