# Upstream provenance

Perfect Ice was imported from
[`mintdotgg/perfect-ice`](https://github.com/mintdotgg/perfect-ice) at commit
`3b2c1a08de50e87c60be613da1368944565817e9`.

The upstream repository did not declare a repository-wide software license.
On 2026-08-17, the developer explicitly authorized adding this adaptation to
Mint Playground with `status: "published"`. This record does not claim or
change a license for the upstream repository or authorize a separate public
source mirror.

The adaptation preserves the upstream Vite, TypeScript, and Three.js game;
five rink layouts; resurfacer handling; coverage, resource, collision, route,
scoring, audio, keyboard, gamepad, and touch systems. Repository-only docs,
tests, scripts, server middleware, lockfiles, Git metadata, build output, and
local dependencies were excluded.

The thirteen models, seven sounds, and decal atlas used at runtime load from
verified immutable Mint CDN artifacts recorded in `mint-assets.json`. The 34
local generated runtime files (12,057,859 bytes) were excluded from the
portable capsule.
