# Upstream provenance

Blacksite: Echo was imported from
[`mintdotgg/zombies`](https://github.com/mintdotgg/zombies) at commit
`6a347933a1745556a6b90b93d13d06ade5a5a957` under its MIT license.

The adaptation preserves the upstream Vite, TypeScript, Three.js, Rapier, and
SparkJS experience; tactical mission, platform selection, weapons, enemies,
UI, audio, Maps Outbreak, and six-room undead survival systems. Repository-only
docs, tests, scripts, editor middleware, lockfiles, Git metadata, build output,
and local dependencies were excluded.

All runtime media and streamed worlds load from verified immutable Mint CDN
artifacts recorded in `mint-assets.json`. The 221 local generated runtime files
(314,336,755 bytes) were excluded. Thirteen local-only derived files—the
optimized knife and twelve animation-only zombie clips—were replaced with
their exact original Mint CDN artifacts. Browser-bundled provenance data was
also reduced to public asset identifiers and runtime delivery fields.

The upstream internal coverage status remains unchanged in the bundled project
manifest. On 2026-08-17, the developer separately and explicitly authorized
publishing this Playground adaptation with `status: "published"`.
