# Upstream provenance

Splat Playground was imported from
[`CloudyLo001/change-character-world`](https://github.com/CloudyLo001/change-character-world)
at commit `ee0ee3597545216ad4b69ce32402d5d17fb26607`.

The upstream repository did not declare a repository-wide software license.
On 2026-08-17, the developer explicitly approved all publication gates for
adding the project to Play with `status: "published"`, including publication
of the Mint Playground adaptation in `mintdotgg/mint-playground` under that
mirror's MIT license. This permission applies to the Playground adaptation
only and does not claim or change a license for the upstream repository.

The adaptation preserves the upstream Vite, TypeScript, Three.js, and SparkJS
architecture; six hot-swappable Gaussian-splat worlds; four rigged characters;
third-person locomotion; collision and grounding; adaptive environment
lighting; contact shadows; orbit controls; and local browser asset imports.
Repository-only agent configuration, capture and fixture scripts, visual-test
templates, npm and pnpm lockfiles, Git metadata, build output, and local
dependencies were excluded.

The six world streams, six colliders, six previews, four rigged characters,
and four shared locomotion clips load from verified immutable Mint CDN
artifacts recorded in `mint-assets.json`. The 18 local generated runtime files
(16,977,822 bytes) were excluded; the shared local clip copies were replaced
with the canonical Mint animation artifacts.
