// Hand-tuned values chosen for how the game feels in the 3D chase view, with
// the pipe gap as the world's reference dimension (3.1 units).
//
// Distances here deliberately do NOT match the original Flappy Bird. Measured
// against its pipe gap (120px, 30 fps), the original runs at 1.54 gaps of pipe
// spacing, 1.25 gaps/s of scroll and 7.5 gaps/s^2 of gravity; this build is
// roomier and quicker on all three, which reads better with a camera behind
// the bird. What is matched is what the player feels: 1.20s between pipes and
// 5.0 bird-heights of clearance, both essentially the original's.
export const TUNING = {
  // Physics.
  gravity: -37,
  flapVelocity: 11,
  maxFallSpeed: -15,

  // World scroll (the bird's apparent forward speed) and pipe layout.
  scrollSpeed: 5.4,
  // Reaction time between pipes is pipeSpacing / scrollSpeed. At 6.8 that is
  // 1.26s, close to the original's 1.23s. The pipes sit further apart than the
  // original in raw distance, but the faster scroll brings the timing back
  // into the same range.
  pipeSpacing: 6.8,
  pipeGap: 2.8,
  gapCenterMin: 2.8,
  gapCenterMax: 6.2,
  pipeVisualRadius: 0.85,
  pipeColliderRadius: 0.68,

  birdStartY: 4.2,
  birdRadius: 0.34,
  // Difficulty comes from gap height measured in bird heights: the original is
  // a 120px gap against a 34x24px bird, i.e. 5.0 bird-heights of room. This
  // scale puts our collider at 0.62 units tall, so the 2.8-unit gap gives 4.5
  // bird-heights — deliberately tighter than the original.
  birdColliderScale: 0.91,

  groundY: 0,
  ceilingY: 9,

  spawnFarZ: -64,
  recycleZ: 10,

  cameraDistance: 6.8,
  cameraHeight: 1.7,
  cameraLag: 4.5,
  cameraFov: 58,
} as const;

/** Half-height of the bird's collision sphere. */
export const BIRD_COLLIDER_RADIUS = TUNING.birdRadius * TUNING.birdColliderScale;

/**
 * How far past the bird a pipe must travel before it can no longer touch it.
 * Inside this distance a pipe is lethal and must be drawn solid; beyond it a
 * collision is geometrically impossible, so the pipe is safe to hide.
 * Everything that draws or collides pipes derives from this, so the visuals and
 * the collision cannot drift apart when the radii are retuned.
 */
export const PIPE_LETHAL_DEPTH = TUNING.pipeColliderRadius + BIRD_COLLIDER_RADIUS;
