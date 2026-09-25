import { EnemyAirplane } from "./enemy_airplane.js";
import {
  DIFFICULTY,
  getLevelConfig,
  rollInterval,
} from "./config_game.js";

/**
 * Configuration recipes for prsan enemy variants. To add a new variant
 * (faster, smaller, drops bonus, fires back, etc.) add an entry here and
 * choose it via the spawn recipe picker. Each variant can later carry its
 * own score/health/audio callbacks without rewriting the manager.
 *
 * `damage` is overridden at spawn-time by the active difficulty level
 * (see config_game.js — currently a flat 2 across all levels that
 * spawn the airplane). Keep this default in sync if you ever split damage
 * per-recipe.
 */
export const AIRPLANE_RECIPES = Object.freeze({
  default: Object.freeze({
    scale: 0.8,
    minSpeed: 200,         // px/s — slowest pass (half of original 180)
    maxSpeed: 360,        // px/s — fastest pass (double of original 180)
    spawnMargin: 120,     // px past the spawning edge
    scorePenalty: 0,
    damage: 2,
  }),
});

/**
 * Spawns prsan airplanes that fly left-to-right and despawn off-screen.
 *
 * Mirrors the ToniManager pattern: a single active enemy at a time, gated by
 * `this.instances.length === 0`, with a global timer driving the next spawn.
 * Easy to extend later (projectiles, waves) by adding fields to the recipe
 * and reading them inside `spawnOne` / the active-instance branch.
 */
export class AirplaneManager {
  constructor({ audio, assets, player, levelEvents, recipes = AIRPLANE_RECIPES, minInterval = 10, maxInterval = 15, spawnMarginTop = 80, spawnMarginBottom = 80, onPlayerHit, levelConfig = getLevelConfig(DIFFICULTY.EASY) } = {}) {
    this.audio = audio;
    this.assets = assets;
    this.player = player;
    this.recipes = recipes;
    this.minInterval = minInterval;
    this.maxInterval = maxInterval;
    this.spawnMarginTop = spawnMarginTop;
    this.spawnMarginBottom = spawnMarginBottom;
    // Optional: invoked with the enemy world-space coords the moment a hit
    // is accepted. Game.js wires this to collision effects, invincibility,
    // and other side-effects so this manager stays free of cross-concerns.
    this.onPlayerHit = typeof onPlayerHit === "function" ? onPlayerHit : null;
    this.instances = [];
    this.timer = 0;
    // currentLevelConfig is the single source of truth inside this manager
    // for airplaneEnabled / airplaneDamage / interval bounds. update() and
    // spawnOne() read from it instead of taking levelConfig as an argument,
    // and scheduleNext() keeps it in sync when the level transitions via
    // the LevelEvents bus.
    this.currentLevelConfig = levelConfig;
    // levelConfig must be passed here — otherwise the default EASY config
    // disables the airplane entirely (nextSpawn = Infinity) and the first
    // update() never gets a chance to schedule with the real level.
    this.scheduleNext(levelConfig);
    // Subscribe AFTER scheduleNext so the seed call from LevelEvents
    // doesn't double-fire on construction (we already have the right
    // state). The subscribe() helper invokes us once synchronously
    // with the bus's current config to keep us aligned if the bus
    // already holds a newer config than the one passed in.
    if (levelEvents) {
      this.levelEvents = levelEvents;
      levelEvents.subscribe((newCfg) => this.scheduleNext(newCfg));
    }
  }

  reset(levelConfig = getLevelConfig(DIFFICULTY.EASY)) {
    this.instances = [];
    this.timer = 0;
    // Keep currentLevelConfig in sync with what scheduleNext() is about
    // to use — start() in game.js calls reset() with the level config
    // matching the active levelEvents emission, so this stays aligned
    // with whatever LevelEvents has last emitted.
    this.currentLevelConfig = levelConfig;
    this.scheduleNext(levelConfig);
    // Keep the prestarted loop decoded, but silence it until a plane appears.
    this.audio?.silenceAirplane?.();
  }

  scheduleNext(levelConfig = getLevelConfig(DIFFICULTY.EASY)) {
    // currentLevelConfig is the single source of truth for this manager.
    // Anything that needs the active level (spawnOne, spawnFormation,
    // pickFormationSize, …) reads this field. Without keeping it in
    // sync here, a LevelEvents-driven re-arm after a pickup that
    // crossed the MEDIUM/HARD threshold would update nextSpawn but
    // leave spawnOne() reading the stale EASY config — formation
    // sizes, damage, and any future level-gated logic would all lag
    // a frame (or forever, if scheduleNext never fires again).
    this.currentLevelConfig = levelConfig;
    if (!levelConfig.airplaneEnabled) {
      // Easy mode — push the next spawn far into the future so the
      // gate in update() never fires. The level can change at runtime
      // (e.g. difficulty promotion) and the next call here picks up
      // the new interval.
      this.nextSpawn = Number.POSITIVE_INFINITY;
      this.timer = 0;
      return;
    }
    const { airplaneIntervalMin, airplaneIntervalMax } = levelConfig;
    this.nextSpawn = rollInterval(airplaneIntervalMin, airplaneIntervalMax);
  }

  pickRecipe() {
    const keys = Object.keys(this.recipes);
    const key = keys[Math.floor(Math.random() * keys.length)];
    return { key, config: this.recipes[key] };
  }

  spawnOne(width, height) {
    // PERF-DIAG #8 — total spawn cost (constructor + setParts-free path +
    // audio). Read by game.js _spawnLog correlator. Reset on entry so a
    // skipped spawn (no recipe) leaves a 0 in lastSpawnMs and the
    // correlator doesn't attribute a hitch to us.
    const _tSpawn = performance.now();
    const { key, config } = this.pickRecipe();
    // currentLevelConfig is kept in sync by scheduleNext() via the
    // LevelEvents bus — no need to take it as a parameter here.
    const levelConfig = this.currentLevelConfig;
    // Override per-recipe damage with the level-tuned value so a single
    // recipe definition can serve every level.
    const damage = levelConfig.airplaneDamage ?? config.damage;
    const usableHeight = Math.max(1, height - this.spawnMarginTop - this.spawnMarginBottom);
    const y = this.spawnMarginTop + Math.random() * usableHeight;
    // Pick a random speed per spawn between minSpeed and maxSpeed — keeps
    // each pass unpredictable so the player can't time dodges by rhythm.
    const speed = config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed);
    // Fly right-to-left: start past the right edge, move in -x. direction: -1
    // flips the sprite horizontally so the plane visually faces the way it's
    // moving (cabin nose points left when flying left).
    const enemy = new EnemyAirplane(width + config.spawnMargin, y, {
      scale: config.scale,
      direction: -1,
      velocityX: -speed,
      headImage: this.assets?.cache?.get("airplane-head"),
    });
    // PERF-DIAG removed — game.js _spawnLog records the spawn; this
    // console.log was a duplicate.
    this.instances.push({
      enemy,
      recipeKey: key,
      config,
      damage,
      speed,
      // Short grace period so the plane doesn't immediately re-collide with
      // the player on the same frame it spawns. Tunable per recipe later.
      damageCooldown: 0.4,
    });
    // Kick off the looping airplane SFX — volume is updated every frame in
    // update() based on distance from the centre of the screen.
    // PERF-DIAG #8 — measure audio call cost separately so a near-zero
    // lastAudioMs proves audio wasn't the hitch cause. noAudio is checked
    // LIVE (not cached) so toggling __DEBUG.noAudio from the console takes
    // effect on the very next spawn.
    let _tAudio = 0;
    if (!window.__DEBUG?.noAudio) {
      _tAudio = performance.now();
      this.audio?.startAirplane?.("airplane");
      this.lastAudioMs = +(performance.now() - _tAudio).toFixed(2);
    }
    // PERF-DIAG #8 — close out spawn timing AFTER the audio call so the
    // total includes both the constructor work and the audio bootstrap.
    // Read by game.js _spawnLog correlator.
    this.lastSpawnMs = +(performance.now() - _tSpawn).toFixed(2);
    if (window.__DEBUG?.isAirplane) {
      console.log("[airplane] spawned", { x: enemy.x, y, recipe: key, speed: speed.toFixed(0) });
    }
  }

  update(deltaTime, width, height, player) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;

    // Toni pattern: tick the global timer; spawn only when there is no
    // active instance. Once an instance exists, just run its life cycle.
    this.timer += deltaTime;

    if (this.instances.length === 0) {
      if (this.timer >= this.nextSpawn) {
        this.timer = 0;
        // Pull the freshest config from currentLevelConfig (kept in
        // sync via the LevelEvents bus) instead of accepting it as an
        // argument — this matches the new push-based level wiring.
        this.scheduleNext(this.currentLevelConfig);
        this.spawnOne(width, height);
      }
      return;
    }

    const entry = this.instances[0];
    entry.enemy.update(deltaTime);
    if (entry.damageCooldown > 0) {
      entry.damageCooldown = Math.max(0, entry.damageCooldown - deltaTime);
    }

    // Update airplane SFX volume based on how close the plane is to the
    // screen centre. Call before despawn check so the fade-out begins as
    // soon as the plane nears the left edge.
    this.audio?.updateAirplaneSound?.(entry.enemy.x, player?.x ?? 0, width);

    // Despawn once fully off the left edge.
    if (entry.enemy.x < -200) {
      this.instances.shift();
      this.audio?.silenceAirplane?.();
      return;
    }

    // Collision: AABB overlap with the player hitbox. The damage gate lives
    // inside Player.takeDamage() — it checks the invincibility window and
    // is a no-op while invincible. We additionally skip the collision branch
    // here so we don't even spend the AABB test during the post-hit grace
    // period and don't log "hit player" twice in a row.
    const playerBounds = player?.getBounds?.();
    const playerInvincible = this.player?.isInvincible?.(performance.now() / 1000) === true;
    if (playerBounds && entry.damageCooldown === 0 && !playerInvincible) {
      const e = entry.enemy.getBounds();
      const overlaps = !(
        e.right < playerBounds.left ||
        e.left > playerBounds.right ||
        e.bottom < playerBounds.top ||
        e.top > playerBounds.bottom
      );
      if (overlaps) {
        this.player?.takeDamage?.(entry.damage ?? 2);
        // Damage has been applied; start cooldown so a single collision
        // doesn't drain the whole healthbar in one pass.
        entry.damageCooldown = 0.6;
        // Fire the gameplay-side callback: visual effect, sound, and
        // the 2-second player invincibility window live there.
        this.onPlayerHit?.(entry.enemy.x, entry.enemy.y, entry.config);
        if (window.__DEBUG?.isAirplane) {
          console.log("[airplane] hit player, damage=", entry.damage ?? 2);
        }
      }
    }
  }

  draw(ctx) {
    // PERF-DIAG #8 — A/B gate. Flag is checked LIVE so toggling
    // __DEBUG.noDraw from the console takes effect on the very next frame.
    if (window.__DEBUG?.noDraw) return;
    for (const entry of this.instances) entry.enemy.draw(ctx);
  }

  activeItems() {
    return this.instances.length;
  }
}
