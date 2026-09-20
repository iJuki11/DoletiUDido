// Difficulty system — single source of truth for spawn cadence, formation
// size, and per-enemy damage. Other managers (spawner_enemybird.js,
// spawner_airplane.js) read from this module instead of hard-coding their
// own intervals — that way a future "4-line override" only needs to
// touch one file.
//
// The current level is computed from the player's lifetime collectibles
// count (beers + coffees). Once `hasEnteredHard` is true it stays true
// for the rest of the run — the player is never rewarded for going
// backwards. `hasEnteredHard` resets whenever the game restarts.

/** Level names — used as keys into DIFFICULTY_LEVELS and returned from getLevel(). */
export const DIFFICULTY = Object.freeze({
  EASY: "easy",
  MEDIUM: "medium",
  HARD: "hard",
});

/** Inclusive totalCollectibles thresholds. totalCollectibles is `beers + coffees`. */
const EASY_MAX = 19;     // 0..19  → EASY
const MEDIUM_MAX = 69;   // 20..69 → MEDIUM
                          // 70+    → HARD

/**
 * Per-level gameplay tuning. Read by the spawner managers.
 *
 * - birdIntervalMin/Max:  seconds between bird formation spawns
 * - birdMinSize/MaxSize:   number of birds per formation
 * - airplaneIntervalMin/Max: seconds between airplane spawns (Infinity
 *   = never). Easy mode sets these to Infinity so the airplane manager
 *   skips spawning entirely.
 * - airplaneEnabled:      false in Easy mode to short-circuit spawn checks
 * - airplaneDamage:       HP lost per airplane hit (2 today, by spec)
 */
export const DIFFICULTY_LEVELS = Object.freeze({
  [DIFFICULTY.EASY]: Object.freeze({
    birdIntervalMin: 10,
    birdIntervalMax: 10,
    birdMinSize: 1,
    birdMaxSize: 2,
    airplaneEnabled: false,
    airplaneIntervalMin: Infinity,
    airplaneIntervalMax: Infinity,
    airplaneDamage: 2,
  }),
  [DIFFICULTY.MEDIUM]: Object.freeze({
    birdIntervalMin: 6,
    birdIntervalMax: 12,
    birdMinSize: 2,
    birdMaxSize: 4,
    airplaneEnabled: true,
    airplaneIntervalMin: 8,
    airplaneIntervalMax: 15,
    airplaneDamage: 2,
  }),
  [DIFFICULTY.HARD]: Object.freeze({
    birdIntervalMin: 5,
    birdIntervalMax: 10,
    birdMinSize: 3,
    birdMaxSize: 5,
    airplaneEnabled: true,
    airplaneIntervalMin: 8,
    airplaneIntervalMax: 11,
    airplaneDamage: 2,
  }),
});

/**
 * Resolve the current difficulty level from lifetime collectibles count
 * and the sticky `hasEnteredHard` flag.
 *
 * @param {number} totalCollectibles  beers + coffees
 * @param {boolean} hasEnteredHard    sticky flag — once true, level is HARD
 * @returns {string} one of DIFFICULTY.EASY / MEDIUM / HARD
 */
export function getLevel(totalCollectibles, hasEnteredHard) {
  if (hasEnteredHard) return DIFFICULTY.HARD;
  if (totalCollectibles > MEDIUM_MAX) return DIFFICULTY.HARD;
  if (totalCollectibles > EASY_MAX) return DIFFICULTY.MEDIUM;
  return DIFFICULTY.EASY;
}

/**
 * Pull the full level config object for a given level. Falls back to
 * EASY if `level` is unrecognised (defensive — should never happen).
 */
export function getLevelConfig(level) {
  return DIFFICULTY_LEVELS[level] ?? DIFFICULTY_LEVELS[DIFFICULTY.EASY];
}

/** Roll a random integer in [min, max] inclusive. Caller passes already-clamped values. */
export function rollInterval(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return Infinity;
  if (min === max) return min;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.random() * (hi - lo);
}