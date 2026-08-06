import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Vector3 } from "three";
import { OccupancyGrid } from "../src/perception/occupancy";
import { createPhysics } from "../src/sim/physics";

describe("occupancy grid", () => {
  it("starts empty", () => {
    assert.equal(new OccupancyGrid().cellCount, 0);
  });

  it("counts a return once, however many times it is seen", () => {
    const grid = new OccupancyGrid();
    for (let i = 0; i < 50; i += 1) grid.mark(new Vector3(4.2, 3.1, -7.7));
    assert.equal(grid.cellCount, 1);
  });

  it("separates returns that fall in different cells", () => {
    const grid = new OccupancyGrid();
    grid.mark(new Vector3(0.2, 2, 0.2));
    grid.mark(new Vector3(2.0, 2, 0.2)); // > one 1.5 m cell away in x
    grid.mark(new Vector3(0.2, 2, 2.0));
    grid.mark(new Vector3(0.2, 4, 0.2));
    assert.equal(grid.cellCount, 4);
  });

  it("ignores ground clutter", () => {
    const grid = new OccupancyGrid();
    grid.mark(new Vector3(3, 0.1, 3));
    assert.equal(grid.cellCount, 0, "returns off the ground should not be mapped");
    grid.mark(new Vector3(3, 2.0, 3));
    assert.equal(grid.cellCount, 1);
  });

  it("keeps negative coordinates distinct from positive ones", () => {
    // The cell key packs three signed indices into one integer; a sign error
    // here would silently merge opposite corners of the yard.
    const grid = new OccupancyGrid();
    const spots: [number, number, number][] = [
      [10, 3, 10],
      [-10, 3, 10],
      [10, 3, -10],
      [-10, 3, -10],
      [-10, 9, -10],
    ];
    for (const [x, y, z] of spots) grid.mark(new Vector3(x, y, z));
    assert.equal(grid.cellCount, spots.length);
  });

  it("stops recording when disabled", () => {
    const grid = new OccupancyGrid();
    grid.enabled = false;
    grid.mark(new Vector3(5, 5, 5));
    assert.equal(grid.cellCount, 0);
  });

  it("clears on reset", () => {
    const grid = new OccupancyGrid();
    grid.mark(new Vector3(5, 5, 5));
    grid.reset();
    assert.equal(grid.cellCount, 0);
    assert.equal(grid.mesh.count, 0);
  });
});

describe("ray sensing", () => {
  it("measures height above the ground", async () => {
    const physics = await createPhysics([], 0);
    const distance = physics.castDown(new Vector3(0, 7, 0), 100);
    assert.ok(distance !== null, "should have found the ground");
    assert.ok(
      Math.abs((distance as number) - 7) < 0.05,
      `expected ~7 m, measured ${distance}`,
    );
    physics.dispose();
  });

  it("reports nothing when the beam reaches past its range", async () => {
    const physics = await createPhysics([], 0);
    // Fire upward, where there is no geometry at all.
    const up = physics.castRay(new Vector3(0, 5, 0), new Vector3(0, 1, 0), 40);
    assert.equal(up, null);
    physics.dispose();
  });

  it("sees scenery before the ground behind it", async () => {
    const physics = await createPhysics(
      [
        {
          kind: "container",
          object: { } as never,
          centre: new Vector3(0, 1.3, -6),
          halfExtents: [1.45, 1.3, 3.03],
          rotation: 0,
          mass: null,
        },
      ],
      0,
    );
    const forward = physics.castRay(
      new Vector3(0, 1.3, 0),
      new Vector3(0, 0, -1),
      40,
    );
    assert.ok(forward !== null, "should have hit the container");
    // Container spans z = -3.0 .. -9.0, so its near face is ~3 m ahead.
    assert.ok(
      Math.abs((forward as number) - 2.97) < 0.15,
      `expected the near face at ~2.97 m, measured ${forward}`,
    );
    physics.dispose();
  });
});
