import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the published Side One catalog without local-service runtime calls", async () => {
  const [manifestSource, librarySource, variantsSource] = await Promise.all([
    readFile(new URL("../experience.json", import.meta.url), "utf8"),
    readFile(new URL("../app/VinylLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/turntable-variants.ts", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.slug, "side-one");
  assert.equal(manifest.status, "published");
  assert.equal(manifest.runtime.src, "/_experiences/side-one/index.html");
  assert.match(librarySource, /const PLAYGROUND_STATIC_MODE = true;/);
  assert.match(
    variantsSource,
    /https:\/\/cdn\.mint\.gg\/glb\/walnut-console-normalized-/,
  );
  assert.doesNotMatch(variantsSource, /\/assets\/mint\//);
});

test("uses procedural catalog artwork in the public capsule", async () => {
  const catalogSource = await readFile(
    new URL("../app/record-catalog.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(catalogSource, /coverImage:\s*recordAssetUrl/);
});
