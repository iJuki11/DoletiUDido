import { Game } from "./game.js";
import { InputController } from "./input.js";
import { GameUI } from "./ui.js";

const canvas = document.querySelector("#game-canvas");
const input = new InputController(canvas);
const ui = new GameUI();

// Loading screen lifecycle:
//   1. Show the loading overlay immediately so the user sees the bird image
//      the moment our JS runs (the HTML has no `hidden` attribute so the
//      overlay is visible even before this file executes).
//   2. Construct the Game (it kicks off parallax + bird SVG loading in the
//      background).
//   3. Block input — flap/pause shouldn't be reactive while the world
//      hasn't rendered yet.
//   4. Await game.whenReady() — resolves when parallax + bird SVG are both
//      loaded, OR when parallax definitively failed (timeout/throw).
//   5. Switch the same overlay into the "tap to continue" sub-state.
//      We deliberately do NOT fade it out first — the user should see
//      the same screen the whole time, with only the text and bird
//      pulse animation changing. That feels like a single connected
//      moment ("loading… tap") rather than two separate screens.
//   6. Once in tap state, wait for the user's first input (pointer or key).
//      That input dismisses the tap screen and shows the start screen.
//   7. If parallax failed, surface the "Učitavam offline scenu" toast so
//      the user knows why the city doesn't look quite right.
const loadingStart = performance.now();

ui.showLoading();
input.setEnabled(false);

const game = new Game(canvas, input, ui);

const dismissTapScreen = () => {
  // Idempotent — first call wins, subsequent calls are no-ops.
  if (!ui.isTapToContinue()) return;
  ui.hideLoadingImmediate();
  ui.showStart();
  input.setEnabled(true);

  if (game.didParallaxFail()) {
    // Only show the toast if parallax actually failed — happy path stays
    // silent. 5 s is enough for the user to read it before it fades.
    ui.showOfflineToast("Učitavam offline scenu");
  }
};

// Listen for the very first pointer/key event after the world is ready.
// We attach to window with `once: true` per event so the listener removes
// itself after firing; that keeps things tidy if the user mashes keys.
window.addEventListener("pointerdown", dismissTapScreen, { once: true });
window.addEventListener("keydown", dismissTapScreen, { once: true });

(async () => {
  try {
    await game.whenReady();
  } catch (error) {
    // whenReady() doesn't throw in practice — parallax failures are mapped
    // to a resolve via parallaxLoadFailed. But if something unexpected
    // happens (e.g. an asset exception bubbles through) we still want to
    // make sure the loading screen moves forward.
    console.error("[main] whenReady rejected unexpectedly:", error);
  }

  // PERF-FIX — full warm-up before the loading overlay releases. We
  // explicitly await the warm-up (no 2s race timeout) so the loading
  // screen stays up until the GPU upload / decode work is done.
  // warmUpRender() never rejects; failures are caught internally and
  // logged, so gameplay is never blocked by a missing asset.
  try {
    await game.warmUpRender();
  } catch (e) {
    console.warn("[main] warmup threw unexpectedly:", e);
  }

  // Expose the game + a debug switch so the console cheatsheet stays
  // consistent with the older build. Spawner logs are now gated behind
  // `__game.debug.bird` / `__game.debug.npc` / `__game.debug.parallax`
  // and default to off in production.
  globalThis.__game = game;
  globalThis.__game.debug = { bird: false, npc: false, parallax: false };

  // Optional: log the elapsed load time in the console so we can see at a
  // glance whether warm-cache skipping helped. Useful while we're tuning.
  const elapsed = performance.now() - loadingStart;
  console.info(`[main] loading finished in ${elapsed.toFixed(0)} ms`);

  // Single transition: loading → tap. Same DOM element, just the
  // .is-tap class. CSS handles text swap + bird pulse.
  ui.showTapToContinue();
})();

ui.bindActions(
  () => game.start(),
  () => game.start(),
);