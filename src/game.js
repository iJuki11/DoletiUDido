import { Player } from "./player.js";
import { CollectibleManager, COLLECTIBLE_RADIUS_FACTOR } from "./collectibles.js";
import { AssetLoader } from "./assets.js";
import { AudioBus } from "./audio.js";
import { audioConfig } from "./audioConfig.js";
import { AirplaneManager, BirdManager } from "./enemies.js";
import { DIFFICULTY, getLevel, getLevelConfig } from "./difficulty_system.js";
import { NPCManager } from "./npc_manager.js";
import { CollisionEffects, COLLISION_EFFECT_DURATION } from "./collision_effects.js";
import { SKIP_LAYER_IDS, ZOOM_BACKGROUND } from "./parallax-background.js";

const CITY_WORLD_LENGTH = 4500;
const FRAME_TIMING_SAMPLE_SIZE = 120;
const FRAME_TIMING_MAX_AVERAGE = 16.7;
const FRAME_TIMING_WARNING_STD_DEV = 8;

const STATE = Object.freeze({
  START: "start",
  PLAYING: "playing",
  PAUSED: "paused",
  GAME_OVER: "game-over",
});

// Debug overlay — set to false to hide every collider outline drawn by
// Game.drawColliders(). To REMOVE the overlay entirely from production
// code: delete this constant AND delete the call to drawColliders() in
// frame() AND delete the drawColliders() method below.
const DEBUG_COLLIDERS = false;

export class Game {
  constructor(canvas, input, ui, options = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.input = input;
    this.ui = ui;
    // options.onProgress(loaded, total) — fired by loadParallaxBackground()
    // after every batch of CONCURRENCY=4 images. main.js forwards this to
    // GameUI.updateProgress() so the loading screen shows real progress.
    this.onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    this.state = STATE.START;
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 1;
    this.distance = 0;
    this.beers = 0;
    this.score = 0;
    this.speed = 170;
    this.worldX = 0;
    this.lastTime = 0;
    this.pauseTimestamp = 0;
    this.frameTimes = [];
    this.frameTiming = { average: 0, stdDev: 0, samples: 0, withinBudget: true };
    this.frameTimingWarningIssued = false;
    this.popups = [];
    this.cachedGroundY = 0;
    this.cachedSkyGradient = null;
    this.cachedSkyKey = "";
    this.coffees = 0;
    // Difficulty sticky flag — once the player crosses into Hard we never
    // step back down, even if their collectibles count somehow decreases
    // (e.g. a future mechanic). Reset in start() so a new game starts in
    // Easy mode again.
    this.hasEnteredHard = false;
    // Reused every frame so we don't allocate a snapshot object per update.
    this.uiSnapshot = {
      score: 0,
      beers: 0,
      coffees: 0,
      health: 0,
    };
    this.collectibles = new CollectibleManager();
    this.assets = new AssetLoader();
    this.assets.preload([]);
    // Bird SVG parts (body, wing, hat, leftLeg, rightLeg) are loaded once
    // and handed to Player. Player.draw() skips frames until parts arrive.
    this.player = new Player(90, 300, null);
    this.assets
      .loadSvgParts("./assets/images/bird/bird_image.svg", [
        "body",
        "wing",
        "hat",
        "leftLeg",
        "rightLeg",
      ])
      .then((parts) => {
        this.player.parts = parts;
      })
      .catch((err) => {
        // Bird won't render until this resolves. Log once so the failure
        // doesn't get swallowed silently.
        console.error("Failed to load bird SVG parts:", err);
      });
    // Player owns its own HP and invincibility window. takeDamage() on
    // Player already checks isInvincible() internally — no external gate
    // needed. AirplaneManager and any future damage source just calls
    // player.takeDamage(amount).
    this.collisionEffects = new CollisionEffects();
    this.audio = new AudioBus();
    // Resolve the active level once at construction. `beers` and `coffees`
    // are 0 here so this is always the Easy config on a fresh load, but
    // the value still flows through scheduleNext correctly when the
    // constructor calls it. As soon as a pickup happens the difficulty
    // is re-resolved in game.update and the next scheduleNext() picks up
    // the new interval.
    const initialLevelConfig = this.getLevelConfig();
    this.airplaneManager = new AirplaneManager({
      audio: this.audio,
      player: this.player,
      levelConfig: initialLevelConfig,
      // Called the moment a prsan hit is accepted. Triggers the visual
      // burst, the hit sound, and arms the 2-second invincibility window.
      onPlayerHit: (x, y, config) => {
        const now = performance.now() / 1000;
        // Anchor the collision burst on the player's beak (a touch to the
        // right of centre) so the effect reads as "right where the plane
        // hit you" rather than somewhere on the airframe.
        const impactX = this.player.x + 22;
        const impactY = this.player.y - 2;
        this.collisionEffects.trigger(impactX, impactY, {
          // Scale up so the burst almost swallows the bird — sells the hit.
          scale: (config?.scale ?? 0.8) * 2.2,
          damage: config?.damage ?? 1,
        });
        this.audio.playHit();
        // Open the invincibility window now but defer the actual blink
        // until the very tail of the collision burst, so the player keeps
        // solid for the dramatic hit moment and starts blinking soon
        // after. Tunable here — lower = earlier blink, higher = later.
        this.player.grantInvincibility(now, 2, 0.15);
        // Refresh HUD so the lost heart shows up immediately. takeDamage
        // already mutated player.hp; snapshot() will pick up the new value.
        this.ui.update(this.snapshot());
      },
    });
    this.npcManager = new NPCManager();
    // Crow enemy — same lifecycle as the airplane (single active instance,
    // bell-curve SFX, AABB collision against the player) but rendered from
    // enemy_bird.svg parts instead of a hand-drawn canvas. AssetLoader is
    // passed in so parts can be fetched lazily on first spawn attempt.
    this.birdManager = new BirdManager({
      audio: this.audio,
      player: this.player,
      assets: this.assets,
      levelConfig: initialLevelConfig,
      // Called the moment a crow hit is accepted. Reuses the same
      // collisionEffects + audio.playHit + invincibility window as the
      // airplane so a hit feels identical regardless of which enemy
      // triggered it.
      onPlayerHit: (x, y, config) => {
        const now = performance.now() / 1000;
        const impactX = this.player.x + 22;
        const impactY = this.player.y - 2;
        this.collisionEffects.trigger(impactX, impactY, {
          scale: (config?.scale ?? 0.19) * 11.6,
          damage: config?.damage ?? 1,
        });
        this.audio.playHit();
        this.player.grantInvincibility(now, 2, 0.15);
        this.ui.update(this.snapshot());
      },
    });

    this.parallaxProject = null;
    this.parallaxImages = new Map();
    this.parallaxSceneCache = null;
    // True if the parallax load timed out or threw — main.js checks this
    // so it can decide whether to show the offline toast.
    this.parallaxLoadFailed = false;
    // Fire-and-forget: loadParallaxBackground kicks off the JSON+PNG decode
    // pipeline and updates this.parallaxProject once images are ready. The
    // first few frames still use the procedural fallback, so there's no
    // startup hitch on the main thread. We capture the promise so callers
    // that need the "all images decoded" signal (e.g. main.js for the
    // loading screen) can await it via whenReady() — and so a failure
    // here surfaces as an unhandled rejection that main.js can observe.
    this.parallaxLoadPromise = this.loadParallaxBackground().catch((error) => {
      this.parallaxLoadFailed = true;
      // Swallow here so the rejection doesn't blow up the caller. main.js
      // polls `game.parallaxLoadFailed` (via whenReady) to learn about the
      // failure and decide whether to show the offline toast.
      console.warn("[parallax] background load failed:", error);
    });

    this.frame = this.frame.bind(this);
    this.resize = this.resize.bind(this);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", () => {
      this.lastTime = performance.now();
    });

    this.resize();
    // Don't call ui.showStart() here — main.js owns the loading→start
    // handoff. Calling it now would race with the loading overlay and
    // flash the start screen before parallax is ready. main.js calls
    // ui.showStart() only after game.whenReady() resolves.
    // DEBUG ONLY: expose game for console inspection. Safe to leave in —
    // it does not affect gameplay and the only side effect is a single
    // property on window.
    if (typeof window !== "undefined") window.__game = this;
    // Difficulty debug helpers — see difficultytest.txt for the console
    // cheatsheet. `forceDifficulty('hard')` lets a tester promote without
    // grinding collectibles; `addCollectibles(n)` simulates pickups.
    if (typeof window !== "undefined") {
      window.__game.forceDifficulty = (level) => {
        if (!Object.values(DIFFICULTY).includes(level)) {
          console.warn(`Unknown difficulty "${level}". Valid: ${Object.values(DIFFICULTY).join(", ")}`);
          return null;
        }
        // For Medium we need totalCollectibles ≥ 20, otherwise getLevel()
        // will still return Easy on the next read. Push the counters up
        // past the Medium threshold and clear the Hard sticky flag so the
        // user can also walk back down via resetDifficulty(). For Hard we
        // just flip the sticky flag.
        if (level === DIFFICULTY.HARD) {
          this.hasEnteredHard = true;
        } else {
          this.hasEnteredHard = false;
          if (level === DIFFICULTY.MEDIUM && this.computeScore() < 20) {
            // Bump to the lowest Medium value (20). Split as coffees so
            // the UI still shows a believable spread.
            this.coffees += 20 - this.computeScore();
          } else if (level === DIFFICULTY.EASY) {
            // Wipe counters so the player is back at 0 collectibles.
            this.beers = 0;
            this.coffees = 0;
          }
        }
        // Re-arm both spawn timers with the new level's interval so the
        // change is immediately visible in the game loop.
        this.birdManager.scheduleNext(this.getLevelConfig());
        this.airplaneManager.scheduleNext(this.getLevelConfig());
        return this.difficulty;
      };
      window.__game.addCollectibles = (n) => {
        if (!Number.isFinite(n) || n <= 0) return this.difficulty;
        // Split the added pickups evenly between beers and coffees for
        // realistic-looking state; the difficulty system only cares about
        // the total.
        const half = Math.floor(n / 2);
        this.beers += n - half;
        this.coffees += half;
        return this.difficulty;
      };
      window.__game.resetDifficulty = () => {
        this.hasEnteredHard = false;
        return this.difficulty;
      };
    }
    requestAnimationFrame(this.frame);
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, bounds.width);
    this.height = Math.max(1, bounds.height);
    this.canvas.width = Math.round(this.width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);

    // Recompute cached ground + sky gradient when viewport changes.
    this.cachedGroundY = this.computeGroundY();
    this.cachedSkyKey = `${this.width}x${this.height}`;
    this.cachedSkyGradient = this.context.createLinearGradient(0, 0, 0, this.height);
    this.cachedSkyGradient.addColorStop(0, "#c7cbca");
    this.cachedSkyGradient.addColorStop(0.55, "#aeb4b5");
    this.cachedSkyGradient.addColorStop(1, "#858c8e");

    if (this.state === STATE.START || this.state === STATE.GAME_OVER) {
      this.player.x = this.width * 0.25;
      this.player.y = Math.min(this.height * 0.44, this.cachedGroundY - this.player.height);
    }
  }

  start() {
    this.beers = 0;
    this.coffees = 0;
    // Difficulty sticky flag — once the player crosses into Hard we never
    // step back down, even if their collectibles count somehow decreases
    // (e.g. a future mechanic). Reset in start() so a new game starts in
    // Easy mode again.
    this.hasEnteredHard = false;
    this.popups = [];
    this.collisionEffects.clear();
    this.collectibles.reset();
    // Pass the freshly-computed levelConfig so each spawn manager
    // re-arms its timer with the right cadence before the first frame.
    const levelConfig = this.getLevelConfig();
    this.airplaneManager.reset(levelConfig);
    this.birdManager.reset(levelConfig);
    this.npcManager.reset();
    // Reset in place rather than re-instantiating: managers (AirplaneManager)
    // already hold a reference to `player` from the constructor, and
    // swapping `this.player` to a fresh instance would orphan that
    // reference. Player.reset() restores HP, invincibility, velocity.
    this.player.reset(this.width * 0.25, this.height * 0.45);
    this.player.flap();
    this.state = STATE.PLAYING;
    this.input.setEnabled(true);
    this.ui.update(this.snapshot());
    this.ui.showPlaying();
    // Kick off background music (loops until stopMusic is called).
    // Volume comes from audioConfig.music.background — single source of truth.
    this.audio.playMusic("background", audioConfig.music.background.volume);
    this.lastTime = performance.now();
  }

  end() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.GAME_OVER;
    this.input.setEnabled(false);
    this.audio.playGameOver();
    this.audio.stopMusic();
    this.audio.stopAirplane();
    this.ui.showGameOver(this.snapshot());
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.pauseTimestamp = performance.now();
    this.audio.stopMusic();
    this.audio.stopAirplane();
    this.ui.showPaused();
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.PLAYING;
    this.lastTime = performance.now();
    this.audio?.playMusic?.("background", audioConfig.music.background.volume);
    this.ui.hidePaused();
  }

  togglePause() {
    if (this.state === STATE.PLAYING) {
      this.pause();
    } else if (this.state === STATE.PAUSED) {
      this.resume();
    }
  }

  snapshot() {
    // Mutate the cached object in place — the UI only reads fields, and
    // allocating a fresh one per frame is wasted GC pressure at 60 fps.
    const s = this.uiSnapshot;
    s.score = this.computeScore();
    s.beers = this.beers;
    s.coffees = this.coffees;
    s.health = this.player.hp;
    return s;
  }

  computeScore() {
    // Single source of truth for "what is the score". If the formula
    // ever grows (distance multiplier, combo bonus, …) there is now
    // exactly one place to change it.
    return this.beers + this.coffees;
  }

  // Resolve the active difficulty level from current collectibles count
  // and the sticky `hasEnteredHard` flag. Returns the level config object
  // (or a fresh Easy default if state is uninitialised).
  getLevelConfig() {
    const level = getLevel(this.computeScore(), this.hasEnteredHard);
    return getLevelConfig(level);
  }

  // Read-only snapshot for the console debug cheatsheet. Wrapped in a
  // getter so the values always reflect the latest state at call time.
  get difficulty() {
    return {
      level: getLevel(this.computeScore(), this.hasEnteredHard),
      total: this.computeScore(),
      beers: this.beers,
      coffees: this.coffees,
      hasEnteredHard: this.hasEnteredHard,
    };
  }

  frame(timestamp) {
    if (!this.lastTime) this.lastTime = timestamp;
    const frameTime = timestamp - this.lastTime;
    if (frameTime > 0) this.recordFrameTime(frameTime);
    // Cap deltaTime at 100 ms so a single frame skip (resize, GC, tab refocus)
    // doesn't catapult the world forward — but allow more headroom than 0.034
    // so a normal 60 Hz frame (16.7 ms) and a slightly delayed frame (33 ms)
    // both feel smooth.
    const deltaTime = Math.min(frameTime / 1000, 0.1);
    this.lastTime = timestamp;

    // While the loading overlay is on screen, skip BOTH update and draw.
    // Without this guard the canvas would render the procedural fallback
    // (squares / skyline silhouettes) under the loading brand-mark, which
    // was explicitly ruled out by the Faza 10 spec. Once main.js hides the
    // overlay (after whenReady resolves), the next frame runs the normal
    // pipeline.
    const loadingVisible = this.ui && this.ui.loadingScreen && !this.ui.loadingScreen.hidden;
    if (loadingVisible) {
      requestAnimationFrame(this.frame);
      return;
    }

    this.update(deltaTime);
    this.draw();
    requestAnimationFrame(this.frame);
  }

  recordFrameTime(frameTime) {
    this.frameTimes.push(frameTime);
    if (this.frameTimes.length > FRAME_TIMING_SAMPLE_SIZE) this.frameTimes.shift();

    const average = this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length;
    const variance = this.frameTimes.reduce((sum, value) => sum + (value - average) ** 2, 0) / this.frameTimes.length;
    const stdDev = Math.sqrt(variance);
    this.frameTiming = {
      average,
      stdDev,
      samples: this.frameTimes.length,
      withinBudget: average < FRAME_TIMING_MAX_AVERAGE && stdDev < FRAME_TIMING_WARNING_STD_DEV,
    };

    if (
      this.frameTiming.samples === FRAME_TIMING_SAMPLE_SIZE
      && !this.frameTiming.withinBudget
      && !this.frameTimingWarningIssued
    ) {
      console.warn(`[frame-timing] high frame-time deviation: ${this.frameTiming.stdDev.toFixed(1)}ms`);
      this.frameTimingWarningIssued = true;
    }
  }

  update(deltaTime) {
    if (this.input.consumePause()) this.togglePause();

    if (this.state !== STATE.PLAYING) {
      this.input.consumeFlap();
      return;
    }

    this.worldX += this.speed * deltaTime;

    if (this.input.consumeFlap()) {
      this.player.flap();
      this.audio.playJump();
    }

    this.player.update(deltaTime);
    // Speed still ramps with distance — distance is no longer shown in the
    // HUD but it still drives how fast the world scrolls.
    this.speed = Math.min(255, 170 + this.distance * 0.05);
    this.distance += this.speed * deltaTime * 0.055;

    const groundY = this.getGroundY();
    this.collectibles.update(deltaTime, this.speed, this.width, this.height, groundY);
    const levelConfig = this.getLevelConfig();
    this.airplaneManager.update(deltaTime, this.width, this.height, this.player, levelConfig);
    this.birdManager.update(deltaTime, this.width, this.height, this.player, levelConfig);
    this.npcManager.update(deltaTime, this.width, this.height, groundY);
    this.collisionEffects.update(deltaTime);
    const collectedItems = this.collectibles.collect(this.player.getBounds());

    for (const item of collectedItems) {
      if (item.type === "coffee") {
        this.audio.playCoffee();
        this.coffees += 1;
        this.popups.push({ x: item.x, y: item.y, age: 0, value: "+1" });
      } else {
        this.beers += 1;
        this.audio.playBeer();
        this.popups.push({ x: item.x, y: item.y, age: 0, value: "+1" });
      }
    }
    // Refresh HUD only when something visible to it changed (collect
    // event here; hit event in onPlayerHit; start/end reset it).
    // The DOM cache in ui.js is a backstop — these calls are cheap.
    if (collectedItems.length > 0) this.ui.update(this.snapshot());

    for (const popup of this.popups) {
      popup.age += deltaTime;
      popup.y -= 34 * deltaTime;
    }
    // Swap-and-pop to avoid allocating a new array every frame.
    for (let i = this.popups.length - 1; i >= 0; i -= 1) {
      if (this.popups[i].age >= 0.85) this.popups.splice(i, 1);
    }

    const bounds = this.player.getBounds();
    if (bounds.top <= 4 || bounds.bottom >= groundY || this.player.isDead()) this.end();
  }

  getGroundY() {
    return this.cachedGroundY;
  }

  computeGroundY() {
    // Where the scene's authored ground line lands on screen. The scene is
    // drawn at native scale anchored to the top, so scene.groundY=595 in
    // scene pixels lands here in viewport pixels. The player must stay above
    // this line.
    if (!this.parallaxProject) {
      return this.height - Math.max(46, this.height * 0.065);
    }
    const scene = this.parallaxProject.scene;
    const zoom = Number.isFinite(ZOOM_BACKGROUND) && ZOOM_BACKGROUND > 0 ? ZOOM_BACKGROUND : 1;
    const scale = (this.height / scene.canvas.height) * zoom;
    return Math.round(scene.groundY * scale);
  }

  async loadParallaxBackground() {
    const onProgress = this.onProgress;
    // Race the actual load against a hard 5 s deadline. If the parallax
    // JSON or any image fails (offline, 404, hung connection) we want to
    // give up rather than block the player behind a spinner forever. After
    // the deadline the game continues with the procedural fallback and
    // main.js hides the loading screen + shows an offline toast.
    const PARALLAX_LOAD_TIMEOUT_MS = 5000;
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve({ timedOut: true }), PARALLAX_LOAD_TIMEOUT_MS);
    });
    const loadPromise = this._loadParallaxBackgroundImpl(onProgress);

    const result = await Promise.race([
      loadPromise.then((value) => ({ ok: true, value })),
      timeoutPromise,
    ]);
    if (result && result.timedOut) {
      // Force the load promise to reject so the failure path below can
      // surface the offline toast. We can't cancel the underlying fetches
      // without AbortController plumbing, but the Promise.race already gave
      // us the timeout signal — what matters is that we report the failure
      // to the UI now rather than later.
      try {
        await Promise.race([loadPromise, new Promise((r) => setTimeout(r, 250))]);
      } catch (_) {
        // The eventual rejection will be swallowed by the unhandled-rejection
        // handler that the original implementation already logs in catch().
      }
      throw new Error(
        `Parallax load exceeded ${PARALLAX_LOAD_TIMEOUT_MS} ms timeout`,
      );
    }
    return result.value;
  }

  async _loadParallaxBackgroundImpl(onProgress) {
    try {
      const response = await fetch("./assets/backgrounds/background.parallax.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const project = await response.json();
      // Decode foreground assets first so the playable scene is visible
      // within the first frame or two; far/mid layers can land a moment
      // later. The sky / sun / clouds layers are not used by the game
      // (see docs/parallax-bug-sun-clouds.md) so we deprioritise them.
      const SCENE_LAYER_PRIORITY = [
        "road", "cafe", "house", "hedge", "lamps", "trees",
        "06c-houses-front", "06b-houses-middle", "06a-houses-back",
        "mid", "far",
      ];
      const layerByAssetId = new Map();
      for (const layer of project.scene.layers) {
        for (const object of layer.objects || []) {
          if (!layerByAssetId.has(object.assetId)) {
            layerByAssetId.set(object.assetId, layer.id);
          }
        }
      }
      const order = (asset) => {
        const layerId = layerByAssetId.get(asset.id);
        const idx = SCENE_LAYER_PRIORITY.indexOf(layerId);
        return idx === -1 ? SCENE_LAYER_PRIORITY.length : idx;
      };
      const sortedAssets = [...project.assets].sort((a, b) => order(a) - order(b));
      // Decode in chunks of 4 at a time so we don't spike 34 simultaneous
      // decode jobs — that would jank the first paint hard on phones.
      const CONCURRENCY = 4;
      // Fire the first progress signal up front so the loading screen can
      // reveal its determinate widgets ("0 / 34 slika") even before any
      // image finishes decoding. The percentage UI stays hidden via CSS
      // until .has-progress is on the parent element.
      onProgress?.(0, sortedAssets.length);
      for (let i = 0; i < sortedAssets.length; i += CONCURRENCY) {
        const batch = sortedAssets.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (asset) => {
          if (this.parallaxImages.has(asset.id)) return;
          const image = new Image();
          image.src = asset.data;
          await image.decode();
          this.parallaxImages.set(asset.id, image);
        }));
        // Report progress in terms of how many batches we *started*. If the
        // last batch is shorter than CONCURRENCY we still clamp the upper
        // bound to sortedAssets.length so the text never reads "36 / 34".
        const done = Math.min(i + CONCURRENCY, sortedAssets.length);
        onProgress?.(done, sortedAssets.length);
      }
      this.parallaxProject = project;
      // Pre-build the scene we hand to ParallaxRuntime every frame. Drops:
      //   - sky layer (game paints its own viewport gradient)
      //   - sun and clouds (loop-only export puts them only in part 1 of the
      //     PNG, so when the parallax phase crosses the 4096→4500 boundary the
      //     viewport shows an empty sky strip — see docs/parallax-bug-sun-clouds.md)
      //   - any SKIP_LAYER_IDS duplicates
      // The remaining layers (far, mid, houses, road, ...) all wrap correctly.
      const scene = project.scene;
      const sceneForRuntime = {
        ...scene,
        layers: scene.layers
          .filter((layer) =>
            layer.id !== "sky" &&
            layer.id !== "sun" &&
            layer.id !== "clouds" &&
            !SKIP_LAYER_IDS.has(layer.id)
          )
          .map((layer) => {
            return { ...layer };
          }),
      };
      this.parallaxSceneCache = sceneForRuntime;
      // The scene changed — refresh ground cache so the player doesn't spawn
      // or rest on a fallback ground line.
      this.cachedGroundY = this.computeGroundY();
    } catch (error) {
      console.warn("[parallax] failed to load:", error);
      // Re-throw so loadParallaxBackground()'s caller (the Game constructor)
      // can surface the failure to main.js, which then shows the offline
      // toast. Without this re-throw, callers wouldn't know we fell back.
      throw error;
    }
  }

  /**
   * Resolves once every required asset has loaded — OR has definitively
   * failed (timed out / threw). Used by main.js as the "loading screen can
   * disappear" signal.
   *
   * Two checks both have to pass for a successful resolve:
   *   1. this.parallaxProject !== null   — parallax JSON + decoded images
   *   2. this.player.parts    !== null   — bird SVG parts (body, wing, hat, legs)
   *
   * If parallaxLoadFailed is true (set by the .catch in the constructor),
   * we resolve anyway so the loading screen still goes away — the offline
   * toast is then shown by main.js based on that flag.
   *
   * Polls on rAF rather than chaining Promises because the two readiness
   * sources are independent and finish on different timelines; a Promise
   * chain would force a single "all-done" promise up front and complicate
   * the failure path. rAF gives us ~60 checks/sec which is plenty for a
   * one-shot gate.
   */
  whenReady() {
    return new Promise((resolve) => {
      const check = () => {
        const parallaxReady = this.parallaxProject !== null || this.parallaxLoadFailed;
        const birdReady = this.player.parts !== null;
        if (parallaxReady && birdReady) {
          resolve();
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  }

  /** True if the parallax load failed (timed out or threw). main.js uses
   *  this to decide whether to surface the "Učitavam offline scenu" toast. */
  didParallaxFail() {
    return this.parallaxLoadFailed;
  }

  draw() {
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);

    if (this.parallaxSceneCache && globalThis.ParallaxRuntime) {
      const scene = this.parallaxProject.scene;
      const groundY = this.getGroundY();

      const zoom =
        Number.isFinite(ZOOM_BACKGROUND) && ZOOM_BACKGROUND > 0
          ? ZOOM_BACKGROUND
          : 1;

      const baseScale = this.height / scene.canvas.height;
      const scale = baseScale * zoom;

      context.save();
      context.beginPath();
      context.rect(0, 0, this.width, this.height);
      context.clip();

      // Nebo popunjava prostor koji se otkrije odzumiranjem.
      // Gradient is built once in resize() and reused every frame.
      context.fillStyle = this.cachedSkyGradient;
      context.fillRect(0, 0, this.width, this.height);

      // Podloga ispod razine tla.
      context.fillStyle = "#2f3436";
      context.fillRect(
        0,
        groundY,
        this.width,
        this.height - groundY
      );

      // Draw the full 724px scene at native-ish scale and pin its top to the
      // viewport's top. The road strip is whatever space remains below the
      // scene — typically a few pixels because 724 ≈ viewport.height.
      const scenePixelHeight = scene.canvas.height * scale;
      // Clip to the scene so any tiny overshoot at the bottom doesn't bleed
      // past the road strip.
      context.save();
      context.beginPath();
      context.rect(0, 0, this.width, this.height);
      context.clip();

      globalThis.ParallaxRuntime.render(
        context,
        this.parallaxSceneCache,
        this.parallaxImages,
        this.worldX,
        {
          width: this.width,
          height: scenePixelHeight,
          viewportWidth: this.width / scale,
          clear: false,
        }
      );

      context.restore();

      context.restore();
    } else {
      // Procedural fallback while the editor export loads or if it fails.
      this.drawSky(context);
      this.drawClouds(context);
      this.drawSkyline(context, 0.16, this.height * 0.52, "#969c9e", 54, 105);
      this.drawSkyline(context, 0.34, this.height * 0.68, "#737a7c", 68, 150);
      this.drawSkyline(context, 0.62, this.height * 0.79, "#50575a", 84, 210);
      this.drawGround(context);
    }

    this.collectibles.draw(context);
    this.airplaneManager.draw(context);
    this.birdManager.draw(context);
    this.npcManager.draw(context);
    // Render the player only on flash-visible frames while invincible; the
    // collision effects overlay sits between the enemy and the player so
    // the burst reads on top of the plane and underneath the recoil.
    const drawNow = performance.now() / 1000;
    if (this.player.shouldDraw(drawNow)) {
      this.player.draw(context);
    }
    this.collisionEffects.draw(context);
    this.drawPopups(context);
    this.drawVignette(context);

    // Debug collider overlay — rendered LAST so outlines sit on top of
    // every sprite. Toggle the DEBUG_COLLIDERS flag at the top of the
    // file to hide; remove the line below to delete this feature.
    //if (DEBUG_COLLIDERS) {
    //  this.drawColliders(context);
    //}
  }

  // Debug — draws a coloured outline around every active collider.
  // To disable entirely: set DEBUG_COLLIDERS to false. To remove from
  // source: delete this method AND the call above AND the constant.
/*   drawColliders(ctx) {
    ctx.save();
    ctx.lineWidth = 2;

    // Player — lime.
    const pb = this.player?.getBounds?.();
    if (pb) {
      ctx.strokeStyle = "lime";
      ctx.strokeRect(pb.left, pb.top, pb.right - pb.left, pb.bottom - pb.top);
    }

    // Bird formation — cyan, one outline per active bird so you can see
    // overlap between birds in the same X column at a glance.
    const birdEntries = this.birdManager?.instances ?? [];
    ctx.strokeStyle = "cyan";
    for (const entry of birdEntries) {
      const b = entry.bird.getBounds();
      ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    }

    // Airplane — yellow.
    const planeEntries = this.airplaneManager?.instances ?? [];
    ctx.strokeStyle = "yellow";
    for (const entry of planeEntries) {
      const b = entry.enemy.getBounds();
      ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    }

    // Collectibles — orange. Items are plain objects ({x, y, size, …}),
    // not classes with getBounds(). The circle below matches the
    // collision radius used by CollectibleManager.collect() — that IS
    // the real collider, not a visualisation of the sprite bounds.
    ctx.strokeStyle = "orange";
    const items = this.collectibles?.items ?? [];
    if (Array.isArray(items)) {
      for (const item of items) {
        const r = item.size * COLLECTIBLE_RADIUS_FACTOR;
        ctx.beginPath();
        ctx.arc(item.x, item.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // NPCs — magenta. Tries the manager's items list first, falls back
    // to the manager itself if it exposes a single NPC.
    const npcs = this.npcManager?.npcs ?? this.npcManager?.instances ?? [];
    ctx.strokeStyle = "magenta";
    if (Array.isArray(npcs)) {
      for (const n of npcs) {
        const b = n.getBounds?.();
        if (!b) continue;
        ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
      }
    }

    ctx.restore();
  } */

  drawSky(context) {
    context.fillStyle = this.cachedSkyGradient;
    context.fillRect(0, 0, this.width, this.height);

    context.fillStyle = "rgba(242, 240, 225, 0.38)";
    context.beginPath();
    context.arc(this.width * 0.78, this.height * 0.17, 42, 0, Math.PI * 2);
    context.fill();
  }

  drawClouds(context) {
    const offset = (this.worldX * 0.08) % (this.width + 230);
    for (let index = -1; index < 3; index += 1) {
      const x = index * 230 - offset + 70;
      const y = this.height * (0.18 + (index % 2) * 0.09);
      context.fillStyle = "rgba(235, 237, 233, 0.55)";
      context.beginPath();
      context.ellipse(x, y, 54, 17, 0, 0, Math.PI * 2);
      context.ellipse(x + 28, y - 8, 32, 18, 0, 0, Math.PI * 2);
      context.ellipse(x - 28, y - 5, 28, 15, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  drawSkyline(context, parallax, baseline, color, minWidth, maxHeight) {
    const gap = 7;
    const step = minWidth + gap;
    const offset = (this.worldX * parallax) % step;
    const startIndex = Math.floor((this.worldX * parallax) / step);
    context.fillStyle = color;

    for (let index = -2; index < Math.ceil(this.width / step) + 2; index += 1) {
      const worldIndex = startIndex + index;
      const noise = seededNoise(worldIndex * 7 + Math.round(parallax * 100));
      const width = minWidth * (0.72 + seededNoise(worldIndex * 11) * 0.58);
      const height = maxHeight * (0.42 + noise * 0.58);
      const x = index * step - offset;
      const y = baseline - height;
      context.fillRect(x, y, width, height);

      if (parallax > 0.3) {
        context.fillStyle = "rgba(210, 213, 210, 0.32)";
        const columns = Math.max(1, Math.floor(width / 19));
        for (let column = 0; column < columns; column += 1) {
          for (let row = 0; row < Math.floor(height / 28); row += 1) {
            if ((column + row + worldIndex) % 3 !== 0) {
              context.fillRect(x + 8 + column * 17, y + 11 + row * 25, 5, 8);
            }
          }
        }
        context.fillStyle = color;
      }

      if (parallax > 0.5 && worldIndex % 4 === 0) {
        context.fillRect(x + width * 0.55, y - 23, 3, 23);
        context.beginPath();
        context.arc(x + width * 0.55 + 1.5, y - 25, 4, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  drawGround(context) {
    const groundY = this.getGroundY();
    context.fillStyle = "#2f3436";
    context.fillRect(0, groundY, this.width, this.height - groundY);
    context.fillStyle = "#454b4d";
    context.fillRect(0, groundY, this.width, 8);

    const dashOffset = (this.worldX * 0.9) % 48;
    context.fillStyle = "rgba(255, 255, 255, 0.14)";
    for (let x = -dashOffset; x < this.width; x += 48) {
      context.fillRect(x, groundY + 20, 25, 3);
    }
  }

  drawPopups(context) {
    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "900 20px Inter, system-ui, sans-serif";
    for (const popup of this.popups) {
      const progress = popup.age / 0.85;
      const scale = 0.72 + Math.sin(Math.min(1, progress * 2) * Math.PI * 0.5) * 0.35;
      context.globalAlpha = 1 - progress;
      context.save();
      context.translate(popup.x, popup.y);
      context.scale(scale, scale);
      context.fillStyle = "#fff4c6";
      context.strokeStyle = "rgba(91, 57, 5, 0.6)";
      context.lineWidth = 5;
      context.strokeText(popup.value, 0, 0);
      context.fillText(popup.value, 0, 0);
      context.restore();
    }
    context.restore();
  }

  drawVignette(context) {
    const gradient = context.createRadialGradient(
      this.width * 0.5,
      this.height * 0.42,
      this.width * 0.2,
      this.width * 0.5,
      this.height * 0.5,
      Math.max(this.width, this.height) * 0.72,
    );
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, "rgba(8, 11, 12, 0.16)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);
  }
}

function seededNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
