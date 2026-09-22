import { EnemyBird } from "./enemy_bird.js";
import {
  DIFFICULTY,
  getLevel,
  getLevelConfig,
  rollInterval,
} from "./difficulty_system.js";

/**
 * Configuration recipes for crow enemy variants. To add a new variant
 * (faster, smaller, drops bonus, fires back, etc.) add an entry here and
 * choose it via the spawn recipe picker. Each variant can later carry its
 * own score/health/audio callbacks without rewriting the manager.
 */
export const BIRD_RECIPES = Object.freeze({
  default: Object.freeze({
    scale: 0.19,         // viewBox 640 wide → ~122 px on screen, matches airplane's visual footprint
    minSpeed: 200,        // px/s — slowest pass
    maxSpeed: 280,        // px/s — fastest pass
    spawnMargin: 120,     // px past the spawning edge
    scorePenalty: 0,
    damage: 1,
  }),
});

// Formation grid — Y is divided into a fixed 7-slot vertical grid; X has
// three discrete offsets relative to the lead bird's spawn position.
// Slot height matches the bird's visible footprint so adjacent slots
// never overlap; the leftover space (height - 7 * slotHeight) becomes
// extra margin on top and bottom. This is simpler than computing slots
// from screen height and guarantees the same formation shape everywhere.
const GRID_SLOTS_Y = 6;
// Bird visible footprint (scale 0.19 × 560 viewBox height ≈ 106 px). Use
// a slightly tighter value (80 px) so slots look visually spaced; the
// hitbox is even smaller (0.7× shrink) so collision-wise there's slack.
const BIRD_VISIBLE_HEIGHT = 80;
const BIRD_VISIBLE_WIDTH = 120;  // 640 × 0.19 ≈ 122, rounded down.
// X offsets in bird-width units. ±1 means "one bird width to the left/
// right of the lead" — birds on adjacent X slots overlap visually, which
// reads as a tight formation rather than a row of identical copies.
// X-offset column choices, in units of BIRD_VISIBLE_WIDTH. Negative
// values place a bird to the LEFT of the lead (closer to the player);
// 0 means "in line with the lead". Birds never spawn to the right of
// the lead — that would put them further off-screen and let them enter
// the playfield later than the rest of the formation.
const X_OFFSET_CHOICES = Object.freeze([0, -1]);
// Wider X set used only for formations of 4+ birds, where 2 columns
// aren't enough slots. Still strictly ≤ 0 so no bird spawns further
// off-screen than the lead. 0.5 / 1 / 1.5 half-step the bird width so
// a 4-bird formation reads as a single block, not a stretched line.
const X_OFFSETS_4_PLUS = Object.freeze([-0.5, -1, -1.5]);
// Compute the minimum spawn margin (px past the right edge) so the
// leftmost bird in any formation lands fully off-screen, regardless
// of viewport width. The most-negative entry across both pools is
// used (today -1.5); `SPAWN_MARGIN_SAFETY_BUFFER` adds a full bird
// width of headroom so a bird never appears flush against the edge.
// This is the single place to update if either pool grows.
const MAX_X_OFFSET_DISTANCE = Math.max(
  ...X_OFFSET_CHOICES.map((v) => Math.abs(v)),
  ...X_OFFSETS_4_PLUS.map((v) => Math.abs(v)),
);
const SPAWN_MARGIN_SAFETY_BUFFER = BIRD_VISIBLE_WIDTH; // 120 px headroom
function computeSpawnMargin() {
  return MAX_X_OFFSET_DISTANCE * BIRD_VISIBLE_WIDTH + SPAWN_MARGIN_SAFETY_BUFFER;
}
// Max gap between two consecutive birds on the Y grid, in slot units.
// A pair must satisfy |slot_i - slot_(i+1)| ≤ this. With 7 slots and
// maxGap=2, three birds can spread across slot 0..4 (worst case) but
// not slot 0..6.
const FORMATION_Y_MAX_GAP = 2;
// Largest formation size we'll attempt. 5 keeps enough room for the
// Y+maxGap constraint (worst case 0,2,4,6,5 uses 6 distinct slots).
const MAX_FORMATION_SIZE = 5;

export class BirdManager {
  constructor({
    audio,
    player,
    assets,
    recipes = BIRD_RECIPES,
    minInterval = 10,
    maxInterval = 15,
    spawnMarginTop = 80,
    spawnMarginBottom = 80,
    onPlayerHit,
    partIds = ["farWing", "nearWing", "tail", "feet", "body", "head"],
    svgSrc = "./assets/images/enemy_bird.svg",
    levelConfig = getLevelConfig(DIFFICULTY.EASY),
  } = {}) {
    this.audio = audio;
    this.player = player;
    this.assets = assets;
    this.recipes = recipes;
    this.minInterval = minInterval;
    this.maxInterval = maxInterval;
    this.spawnMarginTop = spawnMarginTop;
    this.spawnMarginBottom = spawnMarginBottom;
    this.onPlayerHit =
      typeof onPlayerHit === "function" ? onPlayerHit : null;
    this.svgSrc = svgSrc;
    this.partIds = partIds;

    this.instances = [];
    this.timer = 0;
    // Cached parts promise — first spawn waits for it, subsequent spawns
    // reuse the resolved object via this.partsCache.
    this.partsPromise = null;
    this.partsCache = null;
    this.scheduleNext(levelConfig);
  }

  reset(levelConfig = getLevelConfig(DIFFICULTY.EASY)) {
    this.instances = [];
    this.timer = 0;
    this.scheduleNext(levelConfig);
    // Stop the bird SFX in case an instance was active when the game
    // restarted; without this the sound would keep looping.
    this.audio?.stopBird?.();
  }

  scheduleNext(levelConfig = getLevelConfig(DIFFICULTY.EASY)) {
    const { birdIntervalMin, birdIntervalMax } = levelConfig;
    this.nextSpawn = rollInterval(birdIntervalMin, birdIntervalMax);
  }

  pickRecipe() {
    const keys = Object.keys(this.recipes);
    const key = keys[Math.floor(Math.random() * keys.length)];
    return { key, config: this.recipes[key] };
  }

  ensureParts() {
    if (this.partsCache) return Promise.resolve(this.partsCache);
    if (!this.assets?.loadSvgParts) return Promise.resolve(null);
    if (!this.partsPromise) {
      this.partsPromise = this.assets
        .loadSvgParts(this.svgSrc, this.partIds)
        .then((parts) => {
          this.partsCache = parts;
          return parts;
        })
        .catch((err) => {
          // Don't poison the cache — allow a later spawn attempt to retry
          // the fetch (matches the airplane head-load retry pattern).
          this.partsPromise = null;
          console.error("Failed to load enemy bird SVG parts:", err);
          return null;
        });
    }
    return this.partsPromise;
  }

  // --- Formation grid helpers --------------------------------------------
  // Y slot count is fixed at GRID_SLOTS_Y. Slot index → Y position:
  //   y = spawnMarginTop + (slot + 0.5) * slotHeight
  // Slot height equals BIRD_VISIBLE_HEIGHT so adjacent slots never overlap
  // and leftover vertical space becomes extra top/bottom margin.
  slotY(slotIndex, height) {
    const slotHeight = BIRD_VISIBLE_HEIGHT;
    const gridHeight = slotHeight * GRID_SLOTS_Y;
    const leftover = Math.max(
      0,
      height - gridHeight - this.spawnMarginTop - this.spawnMarginBottom,
    );
    const top = this.spawnMarginTop + leftover / 2;
    return top + (slotIndex + 0.5) * slotHeight;
  }

  // Pick the lead bird's Y slot uniformly across the 7-slot grid.
  pickLeadSlot() {
    return Math.floor(Math.random() * GRID_SLOTS_Y);
  }

  // Pick the next slot given the previous one, constrained by maxGap.
  // Excludes slots already used in this formation so every bird lands on
  // a unique Y row. If the allowed window collapses (e.g. all 3
  // candidates already taken), widen the window before retrying so we
  // never deadlock — the worst case is a same-row neighbour, which is
  // still better than an infinite loop.
  pickNextSlot(prevSlot, usedSlots) {
    for (let widen = 0; widen <= GRID_SLOTS_Y; widen++) {
      const lo = Math.max(0, prevSlot - FORMATION_Y_MAX_GAP - widen);
      const hi = Math.min(GRID_SLOTS_Y - 1, prevSlot + FORMATION_Y_MAX_GAP + widen);
      const candidates = [];
      for (let s = lo; s <= hi; s++) {
        if (!usedSlots.has(s)) candidates.push(s);
      }
      if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }
    }
    // Should be unreachable for size ≤ 5 with maxGap = 2 across 7 slots,
    // but pick anything free as a last resort.
    for (let s = 0; s < GRID_SLOTS_Y; s++) {
      if (!usedSlots.has(s)) return s;
    }
    return prevSlot; // total fallback; same slot would collide but loop won't hang
  }

  // Pick the full X-offset list for a formation. Birds 1..(size-1) all
  // get DISTINCT offsets from the appropriate pool:
  //   - size ≤ 3: pool = X_OFFSET_CHOICES (3 options, all unique)
  //   - size == 4: pool = X_OFFSETS_4_PLUS (4 options, all unique)
  // For size == 5 the 5th bird repeats one of the first four's offsets
  // (chosen at random) — the rule that "every bird must have a unique
  // Y slot" still holds, so the visual overlap is two birds stacked
  // on the same X column rather than on top of each other.
  pickXOffsets(size) {
    const pool = size <= 3 ? X_OFFSET_CHOICES : X_OFFSETS_4_PLUS;
    const offsets = [];
    // Shuffle pool and take `min(size, pool.length)` unique entries.
    const shuffled = pool.slice().sort(() => Math.random() - 0.5);
    const uniqueCount = Math.min(size, shuffled.length);
    for (let i = 0; i < uniqueCount; i++) offsets.push(shuffled[i]);
    // If size > pool.length, pad by repeating one of the used offsets
    // at random — only size 5 hits this branch today.
    while (offsets.length < size) {
      const copy = offsets[Math.floor(Math.random() * offsets.length)];
      offsets.push(copy);
    }
    return offsets;
  }

  // Pick a formation size in [minSize, maxSize] for the active difficulty
  // level. Defaults to the Easy config when no level is supplied (e.g.
  // tests that bypass the difficulty system).
  pickFormationSize(levelConfig = getLevelConfig(DIFFICULTY.EASY)) {
    const { birdMinSize, birdMaxSize } = levelConfig;
    return (
      birdMinSize +
      Math.floor(Math.random() * (birdMaxSize - birdMinSize + 1))
    );
  }

  spawnFormation(width, height, levelConfig = getLevelConfig(DIFFICULTY.EASY)) {
    const parts = this.partsCache;
    if (!parts) return false;

    const { key, config } = this.pickRecipe();
    const speed =
      config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed);
    const formationSize = this.pickFormationSize(levelConfig);

    // Y slots: lead is random across the 7-slot grid; every subsequent
    // slot is unique AND within maxGap of the previous one. Tracking
    // usedSlots in a Set keeps the uniqueness check O(1).
    const usedSlots = new Set();
    const slots = [this.pickLeadSlot()];
    usedSlots.add(slots[0]);
    for (let i = 1; i < formationSize; i++) {
      const next = this.pickNextSlot(slots[i - 1], usedSlots);
      slots.push(next);
      usedSlots.add(next);
    }

    // X offsets: one per bird, all unique for size ≤ 4; for size 5 the
    // 5th bird repeats a random earlier offset (per "opcija β" — the
    // 5th shares with one of the first four).
    const xOffsets = this.pickXOffsets(formationSize);
    // PERF-DIAG removed — game.js _spawnLog already records every spawn
    // (it samples manager.instance arrays around this update call) so
    // a duplicate console.log here was pure noise.

    // Build each bird instance from its slot + X offset.
    for (let i = 0; i < formationSize; i++) {
      const slotIndex = slots[i];
      const xOffsetUnits = xOffsets[i];
      const xOffset = xOffsetUnits * BIRD_VISIBLE_WIDTH;
      const y = this.slotY(slotIndex, height);
      const bird = new EnemyBird(width + computeSpawnMargin() + xOffset, y, {
        scale: config.scale,
        direction: -1,
        velocityX: -speed,
      });
      bird.setParts(parts);
      // Kick off the one-second wing-flap burst so the bird visibly
      // reacts to entering the screen instead of drifting in flat-winged.
      bird.flap();
      // Diagnostic — exposes formation layout for debugging.
      bird.slotIndex = slotIndex;
      bird.xOffsetUnits = xOffsetUnits;

      this.instances.push({
        bird,
        recipeKey: key,
        config,
        speed,
        damageCooldown: 0.4,
      });
    }

    // One caw per formation, not per bird — the spawn is one event.
    // Bell-curve update later in update() ramps volume based on the lead
    // bird's x.
    this.audio?.startBird?.("bird");
    // Heavy debug payload — full object literal every formation. Only log
    // when explicitly opted in via __game.debug.bird = true.
    if (globalThis.__game?.debug?.bird) {
      console.log("[bird] formation spawned", {
        size: formationSize,
        slots,
        xOffsets,
        speed: speed.toFixed(0),
        recipe: key,
      });
    }
    return true;
  }

  update(deltaTime, width, height, player, levelConfig = getLevelConfig(DIFFICULTY.EASY)) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;

    this.timer += deltaTime;

    if (this.instances.length === 0) {
      if (this.timer >= this.nextSpawn) {
        this.timer = 0;
        this.scheduleNext(levelConfig);
        // Kick off parts load lazily — first spawn will wait for them.
        this.ensureParts();
        this.spawnFormation(width, height, levelConfig);
      }
      return;
    }

    // Update + collision for every active bird in the formation. Iterate
    // backwards so splice() during despawn doesn't skip an entry.
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const entry = this.instances[i];
      entry.bird.update(deltaTime);
      if (entry.damageCooldown > 0) {
        entry.damageCooldown = Math.max(
          0,
          entry.damageCooldown - deltaTime,
        );
      }

      // AABB collision with the player. Same gate as the single-bird
      // path: skip during invincibility or post-hit cooldown.
      const playerBounds = player?.getBounds?.();
      const playerInvincible =
        this.player?.isInvincible?.(performance.now() / 1000) === true;
      if (
        playerBounds &&
        entry.damageCooldown === 0 &&
        !playerInvincible
      ) {
        const e = entry.bird.getBounds();
        const overlaps = !(
          e.right < playerBounds.left ||
          e.left > playerBounds.right ||
          e.bottom < playerBounds.top ||
          e.top > playerBounds.bottom
        );
        if (overlaps) {
          // Bird damage stays 1 per spec — only the airplane's damage is tuned
          // per difficulty level (see difficulty_system.js).
          this.player?.takeDamage?.(entry.config.damage ?? 1);
          entry.damageCooldown = 0.6;
          this.onPlayerHit?.(entry.bird.x, entry.bird.y, entry.config);
          if (globalThis.__game?.debug?.bird) {
            console.log("[bird] hit player, damage=", entry.config.damage ?? 1);
          }
        }
      }
    }

    // Audio volume follows the LEAD bird (lowest x = furthest left =
    // first to exit the screen). Update AFTER the per-bird loop so the
    // bell curve reflects post-update positions. Run before despawn so
    // the fade-out starts as soon as the lead nears the left edge.
    const lead = this.instances[0];
    this.audio?.updateBirdSound?.(
      lead.bird.x,
      player?.x ?? 0,
      width,
    );

    // Despawn birds that have crossed the left edge. Remove from the
    // back of the array (those are likely further right → still on
    // screen) but the loop is index-based so order is correct.
    let removedAny = false;
    for (let i = this.instances.length - 1; i >= 0; i--) {
      if (this.instances[i].bird.x < -200) {
        this.instances.splice(i, 1);
        removedAny = true;
      }
    }
    // If the formation is fully gone, stop the SFX so it doesn't keep
    // looping with volume = 0 forever.
    if (removedAny && this.instances.length === 0) {
      this.audio?.stopBird?.();
    }
  }

  draw(ctx) {
    for (const entry of this.instances) entry.bird.draw(ctx);
  }

  activeItems() {
    return this.instances.length;
  }
}

export default BirdManager;

//. X offset — gdje da ga dodam? Imam dvije opcije:
//A) Simetrično: [-1.5, -0.5, +0.5, +1.5] × birdWidth (120) → [-180, -60, +60, +180] px
//Prednosti: vizualno simetrično, izgleda kao produžetak formacije
//B) Stepenasto: [-2, -1, +1, +2] × birdWidth → [-240, -120, +120, +240] px
//Prednosti: veći razmak između ptica, manje vizualnog preklapanja
//C) Tvoj prijedlog — ako imaš drugu ideju
//Još jedno pitanje: za 5 ptica s 4 offseta, koja se ptica ponavlja?
//Zadnja (5.) ponavlja neki od 4 već korištena
//Ili neka druga logika (npr. uvijek srednja)?
//Javi A/B/C + pravilo ponavljanja pa kod pišem.


