# Upstream provenance

Fieldline Santa Clara was imported from the private
[`mintdotgg/stadium`](https://github.com/mintdotgg/stadium) repository at
commit `3ef88eb2b1a62d2c5e8d44981605c7b6c390787d`.

The upstream repository did not declare a repository-wide software license.
On 2026-08-04, the developer explicitly approved publishing this Playground
adaptation with `status: "published"`, then explicitly authorized releasing the
adaptation through the canonical MIT-licensed `mintdotgg/mint-playground`
mirror. That permission applies only to this Playground adaptation and does not
claim that the private upstream repository is MIT-licensed.

The adaptation preserves the upstream Vite and Three.js architecture,
source-aware stadium data, procedural bowl and chair systems, seat explorer,
seated camera perspectives, comparison tools, sightline and shade analysis,
event-state controls, and object-only rendering contract. The custom Node live
data sidecar becomes an optional external endpoint; the portable build uses
clearly labeled static inputs when no endpoint is configured.

Mint-generated models and crowd ambience load from their verified immutable
Mint CDN artifacts and are recorded in `mint-assets.json`. Copied Mint models
and audio, repository metadata, nested lockfiles, credentials, QA captures,
browser fixtures, calibration media, and non-portable server files were
excluded. The small camera-move cue is recreated procedurally with Web Audio so
the published capsule carries no local runtime media.
