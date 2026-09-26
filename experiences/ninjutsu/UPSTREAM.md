# Upstream provenance

Adapted from [CloudyLo001/ninjutsu](https://github.com/CloudyLo001/ninjutsu)
at commit `fdd632b563d7b5156359e78a2bfd77178ee6781b`.

On 2026-09-26, the developer confirmed permission to release this Playground
adaptation under MIT. Upstream has no repository-wide license declaration;
this permission applies to the adaptation, not unrelated upstream content.

The original vanilla Three.js and MediaPipe architecture is preserved. A small
Node build copies the authored static inputs into a portable capsule. Three.js
0.186.0 and MediaPipe Tasks Vision 1.0.1 remain pinned external dependencies.
Camera frames are processed in the browser. No camera permission is requested
until the visitor starts the experience.

Recorded anime dialogue and all bundled audio clips are omitted. Every effect
uses the upstream Web Audio synthesis code, including smoke for shadow clones.
Mint-generated models and the optional test frame load from the exact upstream
CDN URLs; their verified source IDs are recorded in `mint-assets.json`. No
local generated media is included. The social card uses the bundled test-frame
mode rather than a live camera capture.
