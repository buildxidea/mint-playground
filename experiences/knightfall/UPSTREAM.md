# Upstream provenance

Knightfall was imported from
[`CloudyLo001/batmansim`](https://github.com/CloudyLo001/batmansim) at commit
`94cecfa35c99210e4a0e2cfad6cda1769696ad6c`.

The upstream repository did not declare a repository-wide software license
and its subject matter references third-party superhero intellectual property.
On 2026-08-17, the developer explicitly authorized adding this adaptation to
Mint Playground with `status: "published"`. This record does not claim or
change a license for the upstream repository, grant trademark rights, or
authorize a separate public source mirror.

The adaptation preserves the upstream Vite, TypeScript, and Three.js game;
flight, rescue, camera, weather, post-processing, keyboard, gamepad, and touch
systems. Repository-only docs, tests, scripts, lockfiles, Git metadata, build
output, and local dependencies were excluded.

The models and storm image used at runtime load from verified immutable Mint
CDN artifacts recorded in `mint-assets.json`. The 30 local generated runtime
files were excluded from the portable capsule.
