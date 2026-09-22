// FPSLogic — frame-rate cap extracted from Game.frame().
//
// The game uses requestAnimationFrame, which on high-refresh displays
// (120Hz, 144Hz, 165Hz monitors, ProMotion iPhones, iPad Pros) fires 2-3×
// more often than 60Hz. Drawing frames the user can't see wastes CPU and
// GPU and can mask real perf problems behind a "looks smooth because
// 120fps" illusion.
//
// This module decides whether a given rAF tick should run the update +
// draw pipeline or be dropped. The browser keeps calling rAF; we just
// decline the work for ticks that arrive too soon after the previous
// rendered frame.
//
// Design notes:
//   - The cap is wall-clock based, not step-based. We measure
//     `frameTime` (delta since last rendered frame) and skip ticks where
//     it is below the threshold. This naturally survives tab refocus and
//     GC pauses without needing a "lost time" accumulator.
//   - Default `targetFps = 0` means "no cap" — the original behaviour.
//     The constructor takes an initial value but the only public API is
//     setFps() / getFps() so callers can flip it at runtime.
//   - Pure logic, no DOM, no rAF scheduling. Game owns the rAF loop and
//     asks this module "should I render this tick?" each iteration. That
//     keeps the module trivial to unit-test (construct, feed timestamps,
//     read decisions) and impossible to use wrong.

export class FPSLogic {
  /**
   * @param {number} initialFps - 0 for uncapped, otherwise a positive fps
   *                              (e.g. 60). Capped values <=0 are
   *                              normalised to 0.
   */
  constructor(initialFps = 0) {
    this.setFps(initialFps);
  }

  /**
   * Update the cap. Pass 0 (or null/undefined) to disable.
   * @param {number} fps - target frames per second, or 0 for no cap
   * @returns {number} the effective fps that was applied (rounded)
   */
  setFps(fps) {
    if (fps == null || !Number.isFinite(fps) || fps <= 0) {
      this._targetFrameMs = 0;
      return 0;
    }
    this._targetFrameMs = 1000 / fps;
    return Math.round(fps);
  }

  /**
   * @returns {number} 0 if uncapped, otherwise the rounded fps cap
   */
  getFps() {
    return this._targetFrameMs > 0 ? Math.round(1000 / this._targetFrameMs) : 0;
  }

  /**
   * Query whether the current tick should be rendered. Called by the
   * game loop with `frameTime = timestamp - this.lastTime`.
   *
   * @param {number} frameTimeMs - milliseconds since the last rendered frame
   * @returns {boolean} true → run update + draw; false → re-schedule rAF
   *                    and skip work this tick
   */
  shouldRender(frameTimeMs) {
    return this._targetFrameMs <= 0 || frameTimeMs >= this._targetFrameMs;
  }
}
