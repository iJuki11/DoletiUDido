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
import { FPSLogic } from "./fps_logic.js";
import { KonobariAnimation } from "./konobariAnimation.js";
import { EnemyBird } from "./enemy_bird.js";

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
    this.npcManager = new NPCManager({
      // Konobari pickup: +1 HP, capped by Player.MAX_HP. The (x, y) world-
      // space coordinates of the NPC are forwarded into the heal floater so
      // the "+1" text appears above the right sprite. HUD heart refresh is
      // picked up by ui.update() reading the new player.hp.
      onPlayerHit: (x, y) => {
        this.player.grantHealth(1);
        // Anchor the floater 40 px above the konobar body so the text
        // reads as "from the sprite" rather than overlapping the wheels.
        this.collisionEffects.spawnHealFloater(x, y - 40);
        this.ui.update(this.snapshot());
      },
    });
    // KonobariManager needs the player reference each frame for AABB
    // overlap detection; resetting in place keeps the same instance alive.
    this.npcManager.attachPlayer(this.player);
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

    // PERF-FIX #3 — entity prewarm. Kicks off in the background so the
    // network/decode cost happens during the loading screen, not mid-
    // gameplay when a fresh NPC/airplane/bird is spawned. Awaited from
    // whenReady() below so the loading overlay only releases once every
    // entity image has had a chance to land in this.assets.cache.
    this.entityLoadPromise = this.assets.prewarmEntities();

    // PERF-DIAG #4 — frame cap moved to a dedicated module. Default is
    // uncapped (0) so the game honours whatever refresh rate the
    // display provides. Wire setFpsCap() through this.fpsLogic so the
    // console toggle and the game loop share the same source of truth.
    this.fpsLogic = new FPSLogic(0);

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
      // PERF-DIAG #4 — frame cap toggle. Default 0 = no cap (browser
      // decides). Use `__game.setFpsCap(60)` in the console to lock to
      // 60fps, or `__game.setFpsCap(0)` to release. Delegates to the
      // standalone FPSLogic module so the game loop and the toggle
      // share a single source of truth.
      window.__game.setFpsCap = (fps) => {
        const applied = this.fpsLogic.setFps(fps);
        console.log("FPS cap:", applied === 0 ? "uncapped" : applied + "fps");
        return applied;
      };
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
    // PERF-DIAG #6 — anchor for the "first 5s" red zone in the overlay.
    // Lets us separate hitching that survives warm-up (real bug) from
    // hitching that only happened on cold-cache startup (already paid).
    this.gameplayStartTime = performance.now();
    this._redZonePeakWall = 0;
    // Pass the freshly-computed levelConfig so each spawn manager
    // re-arms its timer with the right cadence before the first frame.
    const levelConfig = this.getLevelConfig();
    this.airplaneManager.reset(levelConfig);
    this.birdManager.reset(levelConfig);
    this.npcManager.reset(levelConfig);
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

    // PERF-DIAG #4 — frame cap. On high-refresh displays (120/144 Hz) the
    // browser fires rAF more often than the game's render cadence and we
    // burn CPU drawing frames the user can't see. fpsLogic.shouldRender()
    // drops intermediate frames by re-scheduling rAF without running
    // update/draw. The skipped frames still count toward perf timing so
    // the overlay sees the true gap, not a misleading "we rendered fast".
    //
    // Toggle: in the console, `__game.setFpsCap(60)` to lock, `__game.setFpsCap(0)`
    // to release. Default is uncapped (the browser decides).
    if (!this.fpsLogic.shouldRender(frameTime)) {
      requestAnimationFrame(this.frame);
      return;
    }

    // PERF-DIAG: stamp frame start so the post-draw block can measure the
    // full frame cost (update + draw). Cheap, no side effects.
    this.frameStartMs = performance.now();

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

    const updateStartMs = performance.now();
    this.update(deltaTime);
    const updateMs = performance.now() - updateStartMs;
    // PERF-DIAG #3: per-step timing. We stamp 4 anchors inside draw() via
    // _perfStepStart markers that the renderer advances. Each step's cost
    // surfaces in the jank log so we know which draw call is the culprit
    // — update vs parallax vs entities vs player vs vignette. Cheap when
    // the frame is fast (just two perf.now() calls); only printed when a
    // frame blows the 25 ms budget.
    this.draw();
    const frameMs = performance.now() - this.frameStartMs;
    requestAnimationFrame(this.frame);

    // PERF-DIAG #2 (replaced): live on-canvas overlay + worst-of-N logging.
    // The console.log spam was unreadable; now we (a) draw a tiny FPS +
    // breakdown HUD in the top-left corner every frame so the user sees
    // the metric in real time, and (b) only emit ONE console.warn per
    // ~1 second for the worst frame observed in that window. That makes
    // the log scannable instead of a wall of identical-looking lines.
    const steps = this._perfSteps || {};
    const stepMs = {
      parallax: steps.parallax ?? 0,
      ent: steps.ent ?? 0,
      player: steps.player ?? 0,
      vig: steps.vig ?? 0,
    };
    // Rolling stats — keep last 60 samples so the overlay shows a stable
    // average and the worst-frame pick has a meaningful window.
    if (!this._frameSamples) this._frameSamples = [];
    // frameTime = wall-clock gap between rAF ticks (what browser saw).
    // frameMs = our measured draw duration. Disagreement between the
    // two pinpoints where the stall happened (see worst-of-N comment).
    this._frameSamples.push({ frameTime, frameMs, updateMs, stepMs, frameStartMs: this.frameStartMs });
    if (this._frameSamples.length > 60) this._frameSamples.shift();
    // Draw the overlay LAST so it sits on top of everything (vignette
    // already painted). We hand it a fresh context state so we don't
    // pollute the canvas2d state for future frames.
    this.drawPerfOverlay();
    // PERF-DIAG #5 — parallax depth correlation. We log the parallax
    // step's exact cost plus the worldX value at the moment it spiked.
    // Patterns we're hunting:
    //   (a) "texture upload" — first time a layer is drawn at GPU level
    //       tends to spike once and then settle. Look for spiking +
    //       steady=cheap.
    //   (b) "loop boundary" — when worldX wraps past 4500px the renderer
    //       drops cached positions and recomputes. Look for spiking at
    //       round(worldX / 4500) edges.
    //   (c) "worldX = X where X is a prime" — random sampling noise
    //       would correlate with nothing. Look for steady=cheap after
    //       a few spikes — that's pattern (a).
    // Logged at INFO (not warn) so it doesn't drown the worst-of-N
    // line. Sampled only on parallax spikes, max once per second.
    if (steps.parallax > 30 && this._parallaxSpikeLogTimer == null) {
      this._parallaxSpikeLogTimer = 0;
    }
    if (this._parallaxSpikeLogTimer != null) {
      this._parallaxSpikeLogTimer += deltaTime;
      if (this._parallaxSpikeLogTimer <= 1.0) {
        const w = this.worldX;
        console.log(
          "[parallax-spike]",
          steps.parallax.toFixed(1) + "ms",
          "worldX=" + Math.round(w),
          "loopPos=" + (w / 4500).toFixed(3),
          "nearestWrap=" + Math.round(w / 4500) * 4500,
          "wrapGap=" + Math.round(w % 4500),
        );
      } else {
        this._parallaxSpikeLogTimer = null;
      }
    }

    // Once per second, log the WORST frame in the last 60 — but ONLY
    // when it actually blew the 60fps budget. If the worst frame was
    // <=18ms the game is healthy and we stay silent. The moment a hitch
    // happens we surface exactly one line per second with the broken-
    // down step costs, so the console stays scannable instead of being
    // a wall of identical 16.7ms noise.
    //
    // frameTime = wall-clock gap between rAF ticks (what the browser
    // actually saw). frameMs = our draw duration. They can disagree:
    //   frameTime=106ms frameMs=5ms   → browser stalled outside our
    //                                   draw (GPU/compositor sync,
    //                                   texture upload, GC).
    //   frameTime=106ms frameMs=105ms → JS-side hitch (we'll see it
    //                                   in the step breakdown).
    this._perfLogTimer = (this._perfLogTimer || 0) + deltaTime;
    if (this._perfLogTimer >= 1.0) {
      this._perfLogTimer = 0;
      let worst = this._frameSamples[0];
      for (const s of this._frameSamples) {
        if (s.frameTime > worst.frameTime) worst = s;
      }
      // Quiet when healthy. 18ms = 60fps budget + a hair of slack.
      if (worst.frameTime > 18) {
        // PERF-DIAG #6 — on the FIRST hitch, install the long-task
        // observer so subsequent samples can attribute the time. We do
        // it lazily so healthy runs don't pay the observer overhead.
        if (!this._longTaskObserverInstalled) this._installLongTaskObserver();
        const drawMs = worst.frameMs - worst.updateMs;
        const s = worst.stepMs;
        const stall = worst.frameTime - worst.frameMs;
        // PERF-DIAG #5/#6 — pinpoint what happens during the stall.
        // Two cheap reads, no observers:
        //   • performance.memory.usedJSHeapSize — Chrome only. If the heap
        //     dropped sharply since the last sample, the browser just ran
        //     a major GC (the most common cause of a 100ms hitch with no JS
        //     work to show for it). We log the delta in MB.
        //   • longTasks[] — populated by a PerformanceObserver registered
        //     lazily on first hitch; if non-empty, the browser blamed a
        //     specific task on the main thread for taking >50ms. The array
        //     is cleared each second so we only log tasks that overlapped
        //     this 1s window.
        const mem = (typeof performance !== "undefined" && performance.memory)
          ? performance.memory.usedJSHeapSize
          : 0;
        const memMB = mem ? (mem / 1048576).toFixed(1) : "n/a";
        const heapDeltaMB = mem && this._lastHeapBytes
          ? (((mem - this._lastHeapBytes) / 1048576)).toFixed(2)
          : "n/a";
        if (mem) this._lastHeapBytes = mem;
        const longTaskCount = this._longTasksSinceLastLog
          ? this._longTasksSinceLastLog.length
          : 0;
        // Correlate long-task entries with this worst hitch by time. The
        // hitch window is [worst.frameStartMs, worst.frameStartMs +
        // worst.frameTime]. We pick the entry whose startTime is closest
        // to frameStartMs (within one frame) and print its full attribution
        // so we can see what the browser blamed for the time.
        let correlated = null;
        if (this._longTasksSinceLastLog && this._longTasksSinceLastLog.length) {
          let bestDelta = Infinity;
          for (const t of this._longTasksSinceLastLog) {
            const dt = Math.abs(t.startTime - worst.frameStartMs);
            // Only consider tasks whose start is within one hitch duration
            // of the worst frame start — otherwise it's noise from
            // earlier in the 1s window.
            if (dt < bestDelta && dt <= Math.max(worst.frameTime, 200)) {
              bestDelta = dt;
              correlated = t;
            }
          }
        }
        const longTaskSummary = this._longTasksSinceLastLog && this._longTasksSinceLastLog.length
          ? `, longTasks=${this._longTasksSinceLastLog.length} max=${Math.max(...this._longTasksSinceLastLog.map(t => t.duration)).toFixed(0)}ms`
          : "";
        if (this._longTasksSinceLastLog) this._longTasksSinceLastLog.length = 0;
        console.warn(
          "[worst 1s]", worst.frameTime.toFixed(1) + "ms",
          "wall=" + worst.frameTime.toFixed(1),
          "draw=" + worst.frameMs.toFixed(1),
          "stall=" + stall.toFixed(1),
          "upd=" + worst.updateMs.toFixed(1),
          "parallax=" + s.parallax.toFixed(1),
          "ent=" + s.ent.toFixed(1),
          "player=" + s.player.toFixed(1),
          "vig=" + s.vig.toFixed(1),
          "heap=" + memMB + "MB",
          "Δheap=" + heapDeltaMB + "MB" + longTaskSummary,
        );
        // PERF-DIAG #7 — correlate hitch with the nearest spawn within the
        // last 1s window. We pick the spawn with the smallest |Δt| vs
        // the worst frame start. If the nearest spawn happened within
        // 200ms of the hitch and on the SAME side (spawn BEFORE hitch),
        // it's likely the cause. The marker prefix is `[hitch↔spawn]` so
        // it's trivial to grep for.
        if (this._spawnLog && this._spawnLog.length) {
          const windowStart = worst.frameStartMs - 1000;
          let nearest = null;
          let nearestAbs = Infinity;
          for (const s2 of this._spawnLog) {
            if (s2.t < windowStart || s2.t > worst.frameStartMs) continue;
            const dt = worst.frameStartMs - s2.t;
            const adt = Math.abs(dt);
            if (adt < nearestAbs) {
              nearestAbs = adt;
              nearest = { ...s2, dt };
            }
          }
          if (nearest && nearestAbs < 500) {
            console.warn(
              `[hitch↔spawn] type=${nearest.type} Δt=${nearest.dt.toFixed(1)}ms (worst frame was ${worst.frameTime.toFixed(0)}ms)`
            );
          }
        }
        // PERF-DIAG #6 — dedicated line for the correlated long-task.
        // Easier to grep for "LONGTASK" than to dig through the
        // worst-1s blob.
        if (correlated) {
          const lt = correlated;
          const offset = (lt.startTime - worst.frameStartMs).toFixed(1);
          const attribSummary = lt.attribution && lt.attribution.length
            ? lt.attribution
                .map((a) => {
                  // The "name" field is the most actionable (script /
                  // layout / paint / decode-image / decode-script /
                  // system). The other fields are present in Chromium
                  // for further triage.
                  return `${a.name}${a.type ? `:${a.type}` : ""}${a.duration ? `(${a.duration.toFixed(0)}ms)` : ""}${a.host ? `@${a.host}` : ""}${a.containerSrc ? ` ${a.containerSrc}` : ""}`;
                })
                .join(" | ")
            : "(no attribution)";
          console.warn(
            `[LONGTASK] start=${lt.startTime.toFixed(1)} ΔvsFrameStart=${offset}ms duration=${lt.duration.toFixed(1)}ms entryType=${lt.entryType} name=${lt.name} attrib=[${attribSummary}]`
          );
        }
      }
    }
  }

  // PERF-DIAG #6 — long-task observer. Browsers report any contiguous
  // main-thread execution >50ms via PerformanceObserver({entryTypes:
  // ["longtask"]}). We capture every field the spec exposes so the
  // correlator can pick the right entry by startTime when a hitch
  // happens. attribution[] (Chromium-only) tells us *which* subsystem
  // the browser blames for the time — usually {containerType, src,
  // host, type, name, duration} — and is the cheapest path to
  // answering "where did the 100ms go?" without manually instrumenting
  // every function.
  //
  // Notes:
  // • entry.duration = contiguous busy time on main thread
  // • entry.startTime = wall-clock anchor (same timeline as rAF)
  // • entry.name / entryType / entry.attribution — debug-only fields,
  //   never read in the hot path
  // • Installed lazily on the first hitch so healthy runs don't pay
  //   the observer overhead.
  _installLongTaskObserver() {
    if (this._longTaskObserverInstalled) return;
    this._longTaskObserverInstalled = true;
    this._longTasksSinceLastLog = [];
    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this._longTasksSinceLastLog.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
            entryType: entry.entryType,
            // Attribution is Chromium-only. We copy whatever fields are
            // present so the correlator can print them without crashing
            // on missing ones. Each attribution item can carry a `name`
            // ("script" / "layout" / "paint" / "system" / "fetch" /
            // "decode-image" / "decode-script") which is the answer we
            // actually want.
            attribution: (entry.attribution ?? []).map((a) => ({
              name: a.name,
              containerType: a.containerType,
              containerSrc: a.containerSrc,
              containerId: a.containerId,
              containerName: a.containerName,
              host: a.host,
              duration: a.duration,
              type: a.type,
            })),
          });
        }
      });
      po.observe({ entryTypes: ["longtask"] });
      console.log("[perf-diag] long-task observer installed");
    } catch (e) {
      // PerformanceObserver isn't supported on every browser — fail
      // silently and fall back to the heap-delta signal.
      console.warn("[perf-diag] long-task observer unavailable:", e?.message ?? e);
    }
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
    // PERF-DIAG #7 — detect entity spawns by watching manager.instance
    // arrays grow across the update() call. We sample lengths BEFORE each
    // manager runs, then AFTER, and any increase is recorded with a
    // performance.now() stamp and the entity type. The worst-1s hitch
    // log then correlates hitch time → nearest spawn type. This is the
    // BEFORE/AFTER comparison that the warm-up fix needs to be
    // validated against — "did the bird-spawn hitch go down?".
    if (!this._spawnLog) this._spawnLog = [];
    const _t0 = performance.now();
    const _lenBefore = {
      plane: this.airplaneManager?.instances?.length ?? 0,
      bird: this.birdManager?.instances?.length ?? 0,
      // NPCManager holds sub-managers (Prsan, Nidjo, Toni, Konobari) so we
      // measure the total count instead of guessing which sub-type grew.
      npc: this.npcManager?.allInstances?.length
        ?? (this.npcManager?.Prsan?.instances?.length ?? 0)
        + (this.npcManager?.Nidjo?.instances?.length ?? 0)
        + (this.npcManager?.Toni?.instances?.length ?? 0)
        + (this.npcManager?.Konobari?.instances?.length ?? 0),
    };
    this.airplaneManager.update(deltaTime, this.width, this.height, this.player, levelConfig);
    this.birdManager.update(deltaTime, this.width, this.height, this.player, levelConfig);
    this.npcManager.update(deltaTime, this.width, this.height, groundY, this.player);
    // PERF-DIAG #7 — record any spawns that happened during this update.
    const _lenAfter = {
      plane: this.airplaneManager?.instances?.length ?? 0,
      bird: this.birdManager?.instances?.length ?? 0,
      npc: this.npcManager?.allInstances?.length
        ?? (this.npcManager?.Prsan?.instances?.length ?? 0)
        + (this.npcManager?.Nidjo?.instances?.length ?? 0)
        + (this.npcManager?.Toni?.instances?.length ?? 0)
        + (this.npcManager?.Konobari?.instances?.length ?? 0),
    };
    const _t1 = performance.now();
    if (_lenAfter.plane > _lenBefore.plane) {
      this._spawnLog.push({ type: "airplane", t: _t1 });
    }
    if (_lenAfter.bird > _lenBefore.bird) {
      this._spawnLog.push({ type: `bird×${_lenAfter.bird - _lenBefore.bird}`, t: _t1 });
    }
    if (_lenAfter.npc > _lenBefore.npc) {
      this._spawnLog.push({ type: `npc×${_lenAfter.npc - _lenBefore.npc}`, t: _t1 });
    }
    // Trim the log so it doesn't grow unbounded during a long run. Keep
    // only the last 10 seconds of spawns — the worst-1s hitch window
    // never looks back further than that anyway.
    const cutoff = _t1 - 10000;
    while (this._spawnLog.length > 0 && this._spawnLog[0].t < cutoff) {
      this._spawnLog.shift();
    }
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
      // PERF-FIX #3 — also wait for entity prewarm (NPC/airplane/bird/
      // konobar heads + bird SVG parts). Main.js gates the loading
      // overlay on whenReady(), so this guarantees the warm-up has every
      // cached image ready before the user can hit IGRAJ. The entity
      // promise is fire-and-forget — mark _entityReady true once it
      // settles (success OR failure, never block on a missing image).
      if (this.entityLoadPromise && this._entityReady === undefined) {
        this.entityLoadPromise.then(
          () => { this._entityReady = true; },
          () => { this._entityReady = true; },
        );
      } else if (this._entityReady === undefined) {
        this._entityReady = true;
      }
      const check = () => {
        const parallaxReady = this.parallaxProject !== null || this.parallaxLoadFailed;
        const birdReady = this.player.parts !== null;
        if (parallaxReady && birdReady && this._entityReady === true) {
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

  // PERF-FIX #2 — GPU cache pre-warm. The diagnostic data showed that the
  // hitching (100-130ms wall, 0.5ms draw, 132ms stall) is caused by the
  // browser lazily uploading parallax layers + player SVG parts to GPU
  // textures the first time they show up in a draw. We pay this cost
  // here, while the loading screen is still up, so the user never sees it.
  //
  // Design choices (with feedback from reviewer):
  //   - Offscreen canvas is the SAME size as the visible canvas, with the
  //     SAME pixelRatio and the SAME clip/translate/scale transforms that
  //     draw() uses. A 2x2 stub was considered but rejected — the browser
  //     is allowed to optimise that path differently from the real one.
  //   - We yield to the event loop between layers (setTimeout 0) so the
  //     main thread never blocks >16ms and the loading screen stays
  //     responsive. The whole sweep runs in well under the caller's 2s
  //     race timeout.
  //   - We render the parallax at 5 worldX positions (0, 1000, 2000, 3000,
  //     4000) to warm different source regions of each loopable layer.
  //   - Exceptions are caught per-layer and logged but never propagate.
  //     This is best-effort: a failure here MUST NOT block the game.
  //   - No internal timeout. The single timeout lives in main.js (Promise
  //     race) so there's only one timer in flight.
  async warmUpRender() {
    const started = performance.now();
    let layersDone = 0;
    let partsDone = 0;
    // Build an offscreen canvas that matches the live canvas so the
    // browser goes through the same GPU upload path. We never attach it
    // to the DOM — only the GPU compositor cares about it.
    let off;
    try {
      off = document.createElement("canvas");
    } catch (_) {
      console.warn("[warmup] cannot create canvas; skipping");
      return;
    }
    off.width = Math.round(this.width * this.pixelRatio);
    off.height = Math.round(this.height * this.pixelRatio);
    const ctx = off.getContext("2d");
    if (!ctx) {
      console.warn("[warmup] cannot get 2d context; skipping");
      return;
    }
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);

    // Helper: yield one macrotask so the loading screen can paint, the
    // event loop can run other handlers, and Chrome doesn't flag us as
    // a "long task" (>50ms blocking).
    const yield_ = () => new Promise((r) => setTimeout(r, 0));

    // --- Parallax layers ---
    // Replicate the relevant subset of draw()'s parallax step: clearRect,
    // sky fill, ground strip, clip, then ParallaxRuntime.render at five
    // worldX positions. Each layer is wrapped in try/catch independently.
    if (this.parallaxSceneCache && globalThis.ParallaxRuntime && this.parallaxProject) {
      const scene = this.parallaxProject.scene;
      const groundY = this.getGroundY();
      const zoom = Number.isFinite(ZOOM_BACKGROUND) && ZOOM_BACKGROUND > 0
        ? ZOOM_BACKGROUND : 1;
      const baseScale = this.height / scene.canvas.height;
      const scale = baseScale * zoom;
      const scenePixelHeight = scene.canvas.height * scale;
      const WARMUP_WORLDX = [0, 1000, 2000, 3000, 4000];
      for (const wx of WARMUP_WORLDX) {
        try {
          ctx.clearRect(0, 0, this.width, this.height);
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, this.width, this.height);
          ctx.clip();
          ctx.fillStyle = this.cachedSkyGradient;
          ctx.fillRect(0, 0, this.width, this.height);
          ctx.fillStyle = "#2f3436";
          ctx.fillRect(0, groundY, this.width, this.height - groundY);
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, this.width, this.height);
          ctx.clip();
          globalThis.ParallaxRuntime.render(
            ctx,
            this.parallaxSceneCache,
            this.parallaxImages,
            wx,
            {
              width: this.width,
              height: scenePixelHeight,
              viewportWidth: this.width / scale,
              clear: false,
            }
          );
          ctx.restore();
          ctx.restore();
          layersDone++;
        } catch (e) {
          console.warn("[warmup] parallax layer render failed at wx=" + wx, e);
        }
        await yield_();
      }
    } else {
      console.warn("[warmup] parallaxSceneCache not ready; skipping parallax");
    }

    // --- Player SVG parts ---
    // The player's draw() does 5 drawImage calls (body, wing, hat, two
    // legs). We replicate that call shape so the GPU uploads the same
    // SVG textures it would on the first real frame.
    const parts = this.player?.parts;
    if (parts) {
      const PART_KEYS = ["body", "wing", "hat", "leftLeg", "rightLeg"];
      for (const key of PART_KEYS) {
        try {
          const img = parts[key];
          if (!img) continue;
          ctx.clearRect(0, 0, this.width, this.height);
          ctx.drawImage(img, 0, 0, 840, 1080);
          partsDone++;
        } catch (e) {
          console.warn("[warmup] player part '" + key + "' failed:", e);
        }
        await yield_();
      }
    } else {
      console.warn("[warmup] player parts not ready; skipping");
    }

    // --- Cached entity images (PERF-FIX #3) ---
    // Every NPC/airplane/bird spawns a fresh HTMLImageElement (or reuses
    // a shared one whose first drawImage call still triggers a GPU
    // texture upload). Iterate this.assets.cache and force-draw each
    // loaded image at least once into the offscreen canvas so the GPU
    // upload happens now, not on the first gameplay draw. Per-image
    // try/catch because a single broken asset must not abort the whole
    // sweep. We yield between batches so the loading screen keeps
    // animating and Chrome's "long task" warning stays quiet.
    let imgCacheDone = 0;
    let imageErrors = 0;
    if (this.assets && this.assets.cache && this.assets.cache.size > 0) {
      const entities = Array.from(this.assets.cache.values()).filter(
        (v) => v instanceof HTMLImageElement && v.complete && v.naturalWidth > 0,
      );
      const W = this.width;
      const H = this.height;
      for (const img of entities) {
        try {
          ctx.clearRect(0, 0, W, H);
          // Draw at the image's natural size, centred. We don't know
          // what dimensions the spawner will use at runtime, so the
          // goal is just to trigger the GPU upload — any drawImage
          // call suffices. Subsequent gameplay draws will overwrite
          // anyway.
          ctx.drawImage(img, 0, 0);
          imgCacheDone++;
        } catch (e) {
          imageErrors++;
          console.warn("[warmup] cached image draw failed", e);
        }
        // Yield every few images to stay below the 50 ms long-task limit.
        if ((imgCacheDone + imageErrors) % 4 === 0) await yield_();
      }
      // Final yield so the loading-screen repaint before main.js
      // swaps the overlay in has a chance to run.
      await yield_();
    } else {
      console.warn("[warmup] no entity cache; skipping img cache sweep");
    }

    // -------------------------------------------------------------------------
    // PERF-FIX-TESTA — Konobari first-use decode + per-frame warm-up.
    //
    // Hypothesis: the first NPCKonobari spawn stalls 50–100 ms because the
    // 2304×2240 PNG sprite sheet finishes its decode + GPU upload only on
    // the first drawImage() call. By preloading the sheet, awaiting its
    // decode, AND drawing seven representative frames (0,1,6,12,18,24,29)
    // onto the offscreen canvas BEFORE gameplay starts, we force the GPU
    // upload to happen on the loading screen instead of mid-game.
    //
    // The KonobariAnimation.draw() path applies translate→rotate→scale→
    // scale(-dir)→drawImage. We replicate that exact pipeline here so the
    // warmed state matches what gameplay will actually exercise.
    // -------------------------------------------------------------------------
    let konobariFramesDrawn = 0;
    try {
      const konobariSheet = await KonobariAnimation.preload();
      if (konobariSheet && konobariSheet.naturalWidth > 0) {
        // Mirror the real draw() transform stack so the warm-up matches
        // gameplay exactly.
        const FRAME_W = 384, FRAME_H = 448, COLS = 6;
        const warmFrames = [0, 1, 6, 12, 18, 24, 29];
        for (const frame of warmFrames) {
          const sx = (frame % COLS) * FRAME_W;
          const sy = Math.floor(frame / COLS) * FRAME_H;
          ctx.save();
          ctx.translate(this.width * 0.5, this.height * 0.5);
          ctx.rotate(0);
          ctx.scale(0.325 * -1, 0.325); // direction -1 like gameplay
          ctx.drawImage(
            konobariSheet,
            sx, sy, FRAME_W, FRAME_H,
            -192, -418, FRAME_W, FRAME_H,
          );
          ctx.restore();
          konobariFramesDrawn++;
          await yield_();
        }
      } else {
        console.warn("[warmup] konobari sheet not ready; skipping frame warmup");
      }
    } catch (e) {
      console.warn("[warmup] konobari warmup failed:", e?.message ?? e);
    }

    // -------------------------------------------------------------------------
    // PERF-FIX-TESTB — EnemyBird real-render warm-up.
    //
    // Hypothesis: the first bird spawn stalls 50–100 ms because the SVG
    // parts are decoded, transformed (translate/rotate/scale + horizontal
    // flip) and uploaded to the GPU only on first draw(). We build a
    // throw-away EnemyBird with the real parts and run bird.draw() several
    // times across different wing phases so the GPU sees the same work it
    // would see during gameplay.
    //
    // NOTE: we do NOT mutate gameplay render code. The instance is created
    // and discarded here only.
    // -------------------------------------------------------------------------
    let birdDraws = 0;
    try {
      // Bird parts are loaded on demand by the spawner via loadSvgParts().
      // Since warmUpRender() runs BEFORE any bird spawns, we need to
      // explicitly request the parts now. We do that by calling the
      // AssetLoader's loadSvgParts() — same call the spawner uses — so
      // the warm-up exercises the EXACT same code path the gameplay will.
      const birdParts = await this.assets.loadSvgParts(
        "./assets/images/enemy_bird.svg",
        ["farWing", "nearWing", "tail", "feet", "body", "head"],
      );
      if (birdParts) {
        const tmp = new EnemyBird(0, 0, { scale: 0.19, direction: -1 });
        tmp.setParts(birdParts);
        // Walk through ~6 wing phases (≈0.55s of wing sweep at 10.8 Hz)
        // so the GPU sees the full range of wingAngle that gameplay
        // will produce.
        for (let i = 0; i < 6; i++) {
          tmp.time = i * 0.0926; // = 1/(2*wingSpeed) for variety
          tmp.draw(ctx);
          birdDraws++;
          await yield_();
        }
      } else {
        console.warn("[warmup] bird parts not in cache; skipping bird warmup");
      }
    } catch (e) {
      console.warn("[warmup] bird warmup failed:", e?.message ?? e);
    }

    const elapsed = performance.now() - started;
    console.log(
      `[warmup] done in ${elapsed.toFixed(0)}ms (parallax×${layersDone}, parts×${partsDone}, imgCache×${imgCacheDone}${imageErrors ? `, imgErrors=${imageErrors}` : ""}, konobari×${konobariFramesDrawn}, bird×${birdDraws})`
    );
  }

  draw() {
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);

    // PERF-DIAG #3 — step anchors. reset() every frame so we don't leak
    // stale values from previous frames into the jank log. Each step then
    // writes its delta into this._perfSteps.<name>; the jank log in
    // frame() reads them. We use perf.now() directly (not the cached
    // frameStartMs) so each step measures its own slice, not the whole
    // frame.
    const steps = (this._perfSteps = {});
    let stepStart = performance.now();

    // PERF-DIAG KILL-SWITCH: ?nopar=1 in URL skips parallax entirely so we
    // can isolate whether parallax is the hitch source. Reading once per
    // draw is fine; no behavior change for normal users.
    const skipParallax = /[?&]nopar=1\b/.test(location.search);

    if (this.parallaxSceneCache && globalThis.ParallaxRuntime && !skipParallax) {
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
      // PERF-DIAG #3: parallax step ended (sky fill + ground strip + parallax render).
      steps.parallax = performance.now() - stepStart;
      stepStart = performance.now();
    } else {
      // Procedural fallback while the editor export loads or if it fails.
      this.drawSky(context);
      this.drawClouds(context);
      this.drawSkyline(context, 0.16, this.height * 0.52, "#969c9e", 54, 105);
      this.drawSkyline(context, 0.34, this.height * 0.68, "#737a7c", 68, 150);
      this.drawSkyline(context, 0.62, this.height * 0.79, "#50575a", 84, 210);
      this.drawGround(context);
      // Fallback path includes procedural sky/clouds/skyline/ground —
      // measure it under "parallax" since it occupies the same screen
      // band, so the jank log still tells us "background draw was slow".
      steps.parallax = performance.now() - stepStart;
      stepStart = performance.now();
    }

    this.collectibles.draw(context);
    this.airplaneManager.draw(context);
    this.birdManager.draw(context);
    this.npcManager.draw(context);
    // PERF-DIAG #3: entity step ended (collectibles + airplane + bird + NPC draws).
    steps.ent = performance.now() - stepStart;
    stepStart = performance.now();
    // Render the player only on flash-visible frames while invincible; the
    // collision effects overlay sits between the enemy and the player so
    // the burst reads on top of the plane and underneath the recoil.
    const drawNow = performance.now() / 1000;
    if (this.player.shouldDraw(drawNow)) {
      this.player.draw(context);
    }
    // PERF-DIAG #3: player step ended.
    steps.player = performance.now() - stepStart;
    stepStart = performance.now();
    this.collisionEffects.draw(context);
    this.drawPopups(context);
    this.drawVignette(context);
    // PERF-DIAG #3: vignette step ended (collision + popups + vignette).
    steps.vig = performance.now() - stepStart;

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

  // PERF-DIAG #2: live on-canvas overlay so the user can SEE the numbers
  // while playing — no DevTools needed. Sits in the top-left corner, fixed
  // 6 lines tall, dark backdrop with light text. Recomputed every frame
  // from this._frameSamples (rolling 60-frame window = ~1s of history).
  // Worst step name is highlighted yellow so you know where to look.
  drawPerfOverlay() {
    if (!this._frameSamples || this._frameSamples.length === 0) return;
    const ctx = this.context;
    // Aggregate over the rolling window.
    let totalFrame = 0;
    let totalWall = 0;
    let maxFrame = 0;
    let maxWall = 0;
    let maxUpdate = 0;
    let maxStall = 0;
    const stepSums = { parallax: 0, ent: 0, player: 0, vig: 0 };
    const stepMax = { parallax: 0, ent: 0, player: 0, vig: 0 };
    for (const s of this._frameSamples) {
      totalFrame += s.frameMs;
      totalWall += s.frameTime;
      if (s.frameMs > maxFrame) maxFrame = s.frameMs;
      if (s.frameTime > maxWall) maxWall = s.frameTime;
      if (s.updateMs > maxUpdate) maxUpdate = s.updateMs;
      const stall = s.frameTime - s.frameMs;
      if (stall > maxStall) maxStall = stall;
      for (const k of Object.keys(stepSums)) {
        stepSums[k] += s.stepMs[k] ?? 0;
        if ((s.stepMs[k] ?? 0) > stepMax[k]) stepMax[k] = s.stepMs[k];
      }
    }
    const n = this._frameSamples.length;
    const avgFrame = totalFrame / n;
    // FPS uses wall-clock (what user sees), not draw duration.
    const fps = n > 0 ? Math.min(120, Math.round(1000 / (totalWall / n))) : 0;
    // Pick the dominant step (largest avg) to highlight in yellow.
    let dominant = "parallax";
    let dominantAvg = stepSums.parallax / n;
    for (const k of ["ent", "player", "vig"]) {
      const v = stepSums[k] / n;
      if (v > dominantAvg) { dominant = k; dominantAvg = v; }
    }
    // Layout: fixed-width box anchored to top-left. Use the device-pixel
    // ratio already applied via setTransform — coords are in CSS pixels.
    const pad = 8;
    const lineH = 14;
    const boxX = pad;
    const boxY = pad;
    const boxW = 220;
    const boxH = lineH * 8 + pad * 2;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);
    ctx.font = "600 11px ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const tx = boxX + pad;
    let ty = boxY + pad;
    const line = (label, value, color = "#fff") => {
      ctx.fillStyle = color;
      ctx.fillText(label, tx, ty);
      ty += lineH;
    };
    // wall = average wall-clock gap between rAF ticks (what user sees).
    // draw = our measured draw time. stall = wall - draw = browser
    // stalling outside our draw (GPU sync, texture upload, GC). When
    // stall is large and parallax is small, the hitch is browser-side
    // and no amount of JS optimisation fixes it.
    line("PERF · wall " + (totalWall / n).toFixed(1) + "ms · " + fps + "fps", "", "#cfe7ff");
    line("  draw " + avgFrame.toFixed(1) + "ms · stall " + maxStall.toFixed(1) + "ms", "", "#fff");
    line("  parallax " + (stepSums.parallax / n).toFixed(1) + " (peak " + stepMax.parallax.toFixed(1) + ")",
      "", dominant === "parallax" ? "#ffd866" : "#fff");
    line("  entities " + (stepSums.ent / n).toFixed(1) + " (peak " + stepMax.ent.toFixed(1) + ")",
      "", dominant === "ent" ? "#ffd866" : "#fff");
    line("  player   " + (stepSums.player / n).toFixed(1) + " (peak " + stepMax.player.toFixed(1) + ")",
      "", dominant === "player" ? "#ffd866" : "#fff");
    line("  vignette " + (stepSums.vig / n).toFixed(1) + " (peak " + stepMax.vig.toFixed(1) + ")",
      "", dominant === "vig" ? "#ffd866" : "#fff");
    // PERF-DIAG #6 — first-5s "red zone" peak. We track the worst frame
    // seen since gameplayStartTime, until either 5s elapse OR the rolling
    // window is past it. This lets us verify the warm-up actually
    // eliminated the cold-start hitch without the long-term average
    // masking it.
    const now = performance.now();
    const sinceStart = this.gameplayStartTime ? (now - this.gameplayStartTime) : Infinity;
    if (this.state === "playing" && sinceStart < 5000 && this.state) {
      // Update peak only during the red zone.
      if (maxWall > (this._redZonePeakWall ?? 0)) this._redZonePeakWall = maxWall;
      const redLabel = "  5s peak " + (this._redZonePeakWall ?? 0).toFixed(1) + "ms (red zone)";
      const redColor = (this._redZonePeakWall ?? 0) > 30 ? "#ff8866" : "#88ff88";
      line(redLabel, "", redColor);
    } else {
      line("  5s peak " + (this._redZonePeakWall ?? 0).toFixed(1) + "ms", "", "#aaa");
    }
    line("  wall peak " + maxWall.toFixed(1) + "ms · draw peak " + maxFrame.toFixed(1) + "ms",
      "", maxStall > 30 ? "#ff8866" : "#aaa");
    ctx.restore();
  }
}

function seededNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
