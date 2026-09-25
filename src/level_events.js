// Tiny event bus for level-config transitions.
//
// The game's difficulty level is derived from the player's lifetime
// collectibles count (beers + coffees) plus a sticky "hasEnteredHard"
// flag (see config_game.js). Managers that care about the level —
// currently AirplaneManager (airplaneEnabled gate + interval roll) and
// BirdManager (interval roll) — used to receive `levelConfig` as an
// argument to update() and poll it every frame for changes. That pulled
// getLevelConfig() into the 60 Hz hot path even though the level
// changes at most a handful of times per run.
//
// This module replaces that pull-based pattern with a push-based one:
// game.js computes the new config (only at moments that matter —
// pickup, start, forceDifficulty) and emits it. Subscribers re-arm
// their timers only on actual transitions, so a steady-state frame
// costs one reference equality check and nothing else.
//
// Why a hand-rolled class instead of an EventEmitter / library:
//   • ~30 lines, no dependency surface
//   • we only need subscribe + emit, no priorities, no async, no error
//     swallowing semantics
//   • keeping the API obvious makes the call sites in game.js read like
//     a sentence — "when the level changes, notify subscribers"

export class LevelEvents {
  constructor() {
    this._listeners = new Set();
    this._current = null;
  }

  /** Read the last-emitted config. Cheap reference read. */
  get current() {
    return this._current;
  }

  /**
   * Subscribe to level transitions. The listener fires for every emit()
   * that represents an actual change (reference inequality OR force).
   *
   * If a config has already been emitted before this subscribe call,
   * the listener is invoked once synchronously with that config so it
   * can seed its own state without a second wiring step.
   *
   * @param {(newConfig: object, oldConfig: object | null) => void} fn
   * @returns {() => void} unsubscribe function
   */
  subscribe(fn) {
    this._listeners.add(fn);
    if (this._current) {
      // Seed: hand the late subscriber the current config so it can
      // align its internal state (e.g. AirplaneManager.scheduleNext).
      fn(this._current, null);
    }
    return () => this._listeners.delete(fn);
  }

  /**
   * Emit a level config. Fires listeners only when the reference
   * changed (or when force is true). Always updates `_current` so
   * late subscribers can be seeded correctly.
   *
   * @param {object} newConfig  the level config from getLevelConfig()
   * @param {{ force?: boolean }} [opts]  force=true bypasses the
   *   reference-equality short-circuit (used by forceDifficulty and
   *   by start() to re-seed timers after a manual reset).
   */
  emit(newConfig, { force = false } = {}) {
    const oldConfig = this._current;
    const changed = force || oldConfig !== newConfig;
    this._current = newConfig;
    if (!changed) return;
    for (const fn of this._listeners) fn(newConfig, oldConfig);
  }
}