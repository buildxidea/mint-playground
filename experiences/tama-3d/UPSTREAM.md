# Upstream provenance

Tama 3D was imported from
[`CloudyLo001/tamagotchi`](https://github.com/CloudyLo001/tamagotchi) at commit
`d0b92b06c0733fa08f5143d080d133369016b37d`.

The upstream repository did not declare a repository-wide software license.
Its README also described the project as local-only and said not to publish it
without Bandai permission. On 2026-08-17, after that notice was surfaced, the
developer explicitly authorized adding this adaptation to Mint Playground with
`status: "published"`. This record preserves the notice; it does not claim or
change a license, grant third-party trademark rights, or authorize a separate
public source mirror.

The adaptation preserves the upstream Vite, TypeScript, and Three.js virtual
pet; care simulation, evolution, minigame, persistence, responsive input, and
device customization. Repository-only docs, scripts, lockfiles, Git metadata,
build output, and local dependencies were excluded.

The character, shell, and backdrop assets used at runtime load from verified
immutable Mint CDN artifacts recorded in `mint-assets.json`. The 34 local
generated runtime files were excluded from the portable capsule.
