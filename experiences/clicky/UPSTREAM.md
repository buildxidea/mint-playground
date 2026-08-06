# Upstream provenance

heyclicky was imported from the private
[`mintdotgg/clicky`](https://github.com/mintdotgg/clicky) repository at commit
`1e6ad84efd7b8ef5b57b8df56c8b587cbc7fe137`.

The upstream repository did not declare a repository-wide software license.
On 2026-08-05, the developer explicitly approved all publication gates for
adding this project to Play with `status: "published"`, including publication
of the Mint Playground adaptation in `mintdotgg/mint-playground` under that
mirror's MIT license. This permission applies to the Playground adaptation
only and does not claim or change a license for the upstream repository.

The adaptation preserves the upstream Vite, React, React Three Fiber, Rive,
video-window, draggable-prop, sticker-mode, easter-egg, pricing, social-proof,
and FAQ architecture. Repository-only agent configuration, duplicated source
captures, design-verification screenshots, generation ledgers, scripts, npm
lockfile, Git metadata, build output, and local dependencies were excluded.

The 27 Mint-generated sticker models load from their verified immutable Mint
CDN artifacts and are recorded in `mint-assets.json`. Their local GLB copies
were excluded after each file's SHA-256 prefix was matched to its production
CDN key. Authored product media, UI artwork, audio, fonts, and Rive files remain
bundled through the Vite source graph.
