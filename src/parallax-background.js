// Single source of truth for parallax scene configuration.
// Parallax speed comes from the JSON itself — each layer in background.parallax.json
// carries a parallax field (0 = stationary, 1 = camera speed). The editor and the
// runtime agree on those values, so we just pass them through. This file no longer
// overrides anything: a layer that the editor stamps as 0.74 in the JSON travels
// at 0.74 of the camera's speed in the game too.
//
// game.js reads these constants and hands the scene to the editor's ParallaxRuntime
// (assets/backgrounds/renderer.js). The runtime is the canonical renderer.

export const ZOOM_BACKGROUND = 1;

// Layer IDs the editor exported but the game must skip (e.g. duplicates).
export const SKIP_LAYER_IDS = new Set([
  "cfb105b7-44de-4982-a88c-84f13653309b",
]);
