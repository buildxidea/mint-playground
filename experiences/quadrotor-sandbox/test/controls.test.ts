import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CONTROL_GROUPS, DEFAULT_BINDINGS } from "../src/input/bindings";
import { GAIN_PRESETS, type GainPresetId } from "../src/sim/config";
import { FIELDS as TUNING_FIELDS } from "../src/ui/tuning";
import { fly } from "./harness";

/** Every key code the app actually responds to, gathered from the source. */
function handledKeyCodes(): Set<string> {
  const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const codes = new Set<string>();

  // The shortcut handler is a switch over event.code string literals.
  for (const match of source.matchAll(/case "([A-Za-z0-9]+)":/g)) {
    codes.add(match[1]);
  }
  // Flight keys live in the bindings table rather than the switch.
  for (const bound of Object.values(DEFAULT_BINDINGS)) {
    for (const code of bound) codes.add(code);
  }
  return codes;
}

/**
 * Map a key code to the label a human would read on the card. Deliberately
 * loose: the card says "W / S" and "1 / 2 / 3", so a substring match on the
 * bare key character is what we can reasonably assert.
 */
function labelFragment(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const named: Record<string, string> = {
    Enter: "Enter",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    BracketLeft: "[",
    BracketRight: "]",
    Slash: "H", // documented as H; `/` is an undocumented alias
    Space: "Space",
    Escape: "Esc",
  };
  return named[code] ?? null;
}

describe("control reference", () => {
  it("documents every key the app responds to", () => {
    // This is the check that would have caught the original defect: the help
    // table existed, was incomplete, and was rendered nowhere.
    const documented = CONTROL_GROUPS.flatMap((g) => g.items)
      .map(([key]) => key)
      .join(" | ");

    const missing: string[] = [];
    for (const code of handledKeyCodes()) {
      const fragment = labelFragment(code);
      if (fragment === null) {
        missing.push(`${code} (no label mapping)`);
        continue;
      }
      if (!documented.includes(fragment)) missing.push(`${code} -> "${fragment}"`);
    }

    assert.deepEqual(
      missing,
      [],
      `undocumented keys:\n  ${missing.join("\n  ")}\ndocumented: ${documented}`,
    );
  });

  it("leads with arming, which is the one key nothing works without", () => {
    const first = CONTROL_GROUPS[0].items[0];
    assert.equal(CONTROL_GROUPS[0].title, "Flying");
    assert.equal(first[0], "Enter");
  });

  it("has no empty groups or blank entries", () => {
    for (const group of CONTROL_GROUPS) {
      assert.ok(group.title.length > 0, "group needs a title");
      assert.ok(group.items.length > 0, `group "${group.title}" is empty`);
      for (const [key, action] of group.items) {
        assert.ok(key.trim().length > 0, `blank key in "${group.title}"`);
        assert.ok(action.trim().length > 0, `blank action for "${key}"`);
      }
    }
  });

  it("documents each key exactly once", () => {
    const keys = CONTROL_GROUPS.flatMap((g) => g.items).map(([key]) => key);
    assert.equal(new Set(keys).size, keys.length, "a key is listed twice");
  });
});

describe("vehicle roster", () => {
  it("documents the aircraft switch and every aircraft the app defines", () => {
    // The X key cycles a table of vehicles. Adding one to the table without
    // mentioning it in the controls card is exactly the kind of silent drift
    // the help-coverage test exists to prevent, so the roster is pinned too.
    const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

    const orderMatch = source.match(/VEHICLE_ORDER\s*:\s*VehicleId\[\]\s*=\s*\[([^\]]*)\]/);
    assert.ok(orderMatch, "could not find VEHICLE_ORDER in main.ts");
    const order = [...orderMatch![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    assert.ok(order.length >= 2, `expected a multi-vehicle roster, found ${order.join(", ")}`);

    // Every id in the cycle must have an entry in the VEHICLES table.
    for (const id of order) {
      assert.ok(
        new RegExp(`^\\s{4}${id}:\\s*\\{`, "m").test(source),
        `"${id}" is in VEHICLE_ORDER but has no entry in the VEHICLES table`,
      );
    }

    // And the card must tell the pilot the switch exists.
    const documented = CONTROL_GROUPS.flatMap((g) => g.items)
      .map(([key, action]) => `${key} ${action}`)
      .join(" | ");
    assert.ok(/\bX\b/.test(documented), "the X aircraft switch is undocumented");
  });
});

describe("tuning panel ranges", () => {
  it("can represent every preset value on its slider", () => {
    // A slider range that does not contain its preset silently clamps the
    // handle: the panel shows a value the controller is not using, and the
    // first drag yanks the gain to the cap. This shipped once — after the
    // airframe was resized, Rate D's preset (0.0139) sat above its 0.012
    // maximum and nothing complained.
    const problems: string[] = [];
    for (const id of Object.keys(GAIN_PRESETS) as GainPresetId[]) {
      const gains = GAIN_PRESETS[id];
      for (const field of TUNING_FIELDS) {
        const value = field.get(gains);
        if (value < field.min || value > field.max) {
          problems.push(
            `${id}.${field.key} = ${value.toFixed(4)} outside slider range ` +
              `[${field.min}, ${field.max}]`,
          );
        }
      }
    }
    assert.deepEqual(problems, [], `\n  ${problems.join("\n  ")}`);
  });
});

describe("takeoff on arm", () => {
  it("climbs to the requested altitude with no stick input", () => {
    const RESTING = 0.072;
    const TAKEOFF = 1.5;

    const { state } = fly(8, {
      altitude: RESTING,
      takeoffAltitude: TAKEOFF,
      // Sticks centred throughout: the climb must come from the hold target
      // alone, which is exactly what arming does.
      pilot: () => ({ roll: 0, pitch: 0, yaw: 0, throttle: 0.5 }),
    });

    assert.ok(
      Math.abs(state.position.y - TAKEOFF) < 0.2,
      `expected a hover near ${TAKEOFF} m, ended at ${state.position.y.toFixed(2)} m`,
    );
    assert.ok(
      Math.abs(state.velocity.y) < 0.25,
      `should have settled, still climbing at ${state.velocity.y.toFixed(2)} m/s`,
    );
  });

  it("still holds station where it is when no altitude is requested", () => {
    // The optional parameter must not change the behaviour every other caller
    // depends on — mode cycling, gain changes and reset-to-pad all rely on it.
    const { state } = fly(6, { altitude: 3 });
    assert.ok(
      Math.abs(state.position.y - 3) < 0.15,
      `expected to hold 3 m, ended at ${state.position.y.toFixed(2)} m`,
    );
  });
});
