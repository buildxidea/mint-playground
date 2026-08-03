# Upstream provenance

Flappy Bird 3D was imported from
[`cloudylo001/flappybird3d`](https://github.com/cloudylo001/flappybird3d) at
commit `01582b379d3eb47c0845dfd93b19369ad7f857cd`.

The upstream repository did not declare a repository-wide software license.
On 2026-08-03, the developer explicitly approved adding the project to Play
with all publication metadata and `status: "published"`, then approved
publishing the Mint Playground adaptation in `mintdotgg/mint-playground` under
that mirror's MIT license. This permission applies to the Playground adaptation
only and does not claim or change a license for the upstream repository. The
adaptation preserves the upstream Vite and Three.js architecture, one-button
flight loop, obstacle recycling, scoring, character picker, and audio
presentation.

Mint-generated models, preview images, and audio load from their verified
immutable Mint CDN artifacts and are recorded in `mint-assets.json`. The
upstream third-party WAV files were replaced with its existing Mint-generated
SFX so the published capsule carries no local runtime media. GitHub deployment
configuration, repository metadata, browser test fixtures, and development
scripts were excluded.
