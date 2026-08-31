# Upstream provenance

Tiny Boat Docking was imported from
[`mintdotgg/boat`](https://github.com/mintdotgg/boat) at commit
`4a734616b5d4a2d3940d02a5a4caa7ba3973fbb4`.

The upstream repository did not declare a repository-wide software license.
On 2026-08-17, the developer explicitly authorized adding this adaptation to
Mint Playground with `status: "published"`. This record does not claim or
change a license for the upstream repository or authorize a separate public
source mirror.

The adaptation preserves the upstream Vite, TypeScript, and Three.js game;
three boats; fifteen courses; wind, wave, wake, traffic, collision, damage,
docking-line, scoring, camera, audio, and touch-control systems. Repository-only
tests, scripts, demo videos, agent configuration, lockfiles, Git metadata,
build output, and local dependencies were excluded.

The twelve models and six sounds used at runtime load from verified immutable
Mint CDN artifacts recorded in `mint-assets.json`. The 18 local generated
runtime files were excluded from the portable capsule.
