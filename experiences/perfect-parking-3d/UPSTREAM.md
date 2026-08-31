# Upstream provenance

Perfect Parking 3D was imported from
[`mintdotgg/park`](https://github.com/mintdotgg/park) at commit
`e7ec5461cde60f9e0f6df725d83f56a8ae687789`.

The upstream repository did not declare a repository-wide software license.
On 2026-08-17, the developer explicitly authorized adding this adaptation to
Mint Playground with `status: "published"`. This record does not claim or
change a license for the upstream repository or authorize a separate public
source mirror.

The adaptation preserves the upstream Vite, TypeScript, Three.js, and Rapier
game; three vehicles; parking and driving challenges; scoring, grounding,
camera, audio, keyboard, and touch systems. Repository-only docs, tests,
scripts, agent configuration, lockfiles, Git metadata, build output, and local
dependencies were excluded.

The ten models and five sounds used at runtime load from verified immutable
Mint CDN artifacts recorded in `mint-assets.json`. The 15 local generated
runtime files were excluded from the portable capsule.
