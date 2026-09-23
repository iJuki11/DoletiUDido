// NPC tuning — single source of truth for every non-enemy NPC.
//
// Konobari (the friendly pickup NPC) lives in `config_game.js` because its
// tuning is keyed off the player's difficulty level (EASY/MEDIUM/HARD).
// Every OTHER atmospheric NPC (Prsan, Nidjo, Toni, Debs) uses flat values
// that don't scale with difficulty — so they live here instead, organised
// by type.
//
// A sub-manager reads from this module instead of hard-coding its own
// intervals, scale and speed. To re-tune any NPC, edit this file; nothing
// in `npc_manager.js` or the individual NPC classes should need touching.
//
// To get a config, call `getNpcConfig('PRSAN')` (or one of the named
// helpers below) — they return a frozen object the caller MUST NOT
// mutate. The lookup is case-insensitive ("PRSAN", "prsan", "Prsan"
// all resolve to the same entry).

/**
 * Per-NPC tuning. Keys are stable identifiers used throughout the
 * codebase (manager properties, lookup helpers). Each value is a frozen
 * object — see `Object.freeze` applied below.
 *
 * Field glossary:
 *   - scale          Default visual scale the sub-manager passes into
 *                    the NPC constructor. NPC classes no longer carry
 *                    their own default; the manager reads it from here.
 *   - scaleJitter    Optional ±range added on top of `scale` to vary the
 *                    population. 0 means exact; e.g. 0.075 with scale
 *                    0.55 yields [0.55, 0.625]. Skipped when undefined.
 *   - intervalMin / intervalMax  Seconds between spawn attempts. The
 *                    sub-manager samples uniformly inside this range.
 *   - speedMin / speedMax  World pixels / second along the travel
 *                    direction (signed via `direction` at spawn time).
 *
 * Per-type extras (fallSpeedMin/Max for Prsan, spawnMargin for the
 * drivables, etc.) live alongside the shared keys so a single lookup
 * carries every parameter the sub-manager needs.
 */
export const NPC_CONFIG = Object.freeze({
  // Prsan — paratrooper NPC, falls from the top with random drift + gusts.
  PRSAN: Object.freeze({
    scale: 0.55,
    scaleJitter: 0.075,        // [0.55, 0.625]
    intervalMin: 5,
    intervalMax: 15,
    fallSpeedMin: 22,
    fallSpeedMax: 42,
    driftMin: -14,
    driftMax: 14,
    spawnPadding: 80,
    spawnAboveScreen: 60,
    despawnBelow: 80,
    // Gust mechanic: short lateral nudges applied to active prsans.
    gustChance: 0.35,
    gustIntervalMin: 1.6,
    gustIntervalMax: 4.2,
  }),

  // Nidjo — grey estate car, drives left↔right across the ground.
  NIDJO: Object.freeze({
    scale: 0.55,
    intervalMin: 8,
    intervalMax: 18,
    spawnMargin: 120,
    speedMin: 120,
    speedMax: 180,
  }),

  // Toni — red tractor unit, drives left↔right across the ground.
  TONI: Object.freeze({
    scale: 0.70,
    intervalMin: 10,
    intervalMax: 22,
    spawnMargin: 140,
    speedMin: 90,
    speedMax: 150,
  }),

  // Debs — floating saucer artwork, drifts left↔right anywhere on canvas.
  DEBS: Object.freeze({
    scale: 0.30,
    intervalMin: 12,
    intervalMax: 22,
    speedMin: 90,
    speedMax: 150,
    spawnMargin: 120,
  }),
});

/** Map of supported lookups; lets us lowercase the input once and still
 *  detect typos. Anything not in this set falls through to DEFAULT (we
 *  intentionally have none — see the throw below). */
const ALIASES = Object.freeze({
  PRSAN: "PRSAN", prsan: "PRSAN",
  NIDJO: "NIDJO", nidjo: "NIDJO",
  TONI:  "TONI",  toni:  "TONI",
  DEBS:  "DEBS",  debs:  "DEBS",
});

/**
 * Resolve the tuning block for an NPC type. Throws on unknown types
 * because silently falling back to a wrong NPC's defaults would spawn
 * invisible bugs during future refactors — fail loud, fail early.
 *
 * @param {string} type  one of "PRSAN" | "NIDJO" | "TONI" | "DEBS" (case-insensitive)
 * @returns {object} frozen tuning block from NPC_CONFIG
 */
export function getNpcConfig(type) {
  const key = ALIASES[type] ?? ALIASES[String(type ?? "").toUpperCase()];
  if (!key) {
    throw new Error(`config_npc: unknown NPC type "${type}" (expected PRSAN | NIDJO | TONI | DEBS)`);
  }
  return NPC_CONFIG[key];
}

/* Convenience helpers — equivalent to getNpcConfig("PRSAN") etc.
 * Manager code can import just the helper it needs. */
export const getPrsanConfig = () => getNpcConfig("PRSAN");
export const getNidjoConfig = () => getNpcConfig("NIDJO");
export const getToniConfig  = () => getNpcConfig("TONI");
export const getDebsConfig  = () => getNpcConfig("DEBS");
