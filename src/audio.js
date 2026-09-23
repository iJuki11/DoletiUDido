import { audioConfig } from "./audioConfig.js";

// AudioBus is the single owner of every audio resource in the game:
//   * One AudioContext + master GainNode for procedural SFX
//     (oscillator/noise — beer, coffee, hit, game-over jingle).
//   * Dedicated HTMLAudioElement instances for long-form looping
//     tracks (background music, airplane drone, bird caw) — HTML5
//     audio is required because Web Audio can't loop MP3 files.
//   * One-shot SFX (jump) use a fresh Audio element per playback so
//     rapid taps stack instead of cutting each other off.
//
// All volume / src defaults live in audioConfig.js — AudioBus is
// the execution layer, audioConfig is the data layer.
export class AudioBus {
  constructor() {
    this.context = null;
    this.master = null;
    this.userInteracted = false;
    this.onUserInput = this.onUserInput.bind(this);
    // Browser policy guard: audio is unlocked only by a real user gesture.
    window.addEventListener("keydown", this.onUserInput, { once: true, passive: true });
    window.addEventListener("pointerdown", this.onUserInput, { once: true, passive: true });

    // Config snapshot — read once at construction so per-method lookups
    // don't re-read the module export every frame.
    this.config = audioConfig;

    // One-shot SFX pool — we keep the most recent element around so we
    // don't allocate an Audio object on every single tap.
    this.jumpElement = null;

    // Fetch ambient clips during loading. Their first playback is started
    // silently by the first user gesture, before an enemy can appear.
    this.prepareAmbient();
  }

  prepareAmbient() {
    if (typeof window === "undefined" || typeof Audio !== "function") return;
    for (const [key, property] of [["airplane", "airplaneElement"], ["bird", "birdElement"]]) {
      const cfg = this.config.ambient[key];
      if (!cfg) continue;
      let element = this[property];
      if (!element) {
        element = new Audio();
        element.loop = cfg.loop !== false;
        element.preload = "auto";
        element.volume = 0;
        this[property] = element;
      }
      const url = new URL(cfg.src, window.location.href).href;
      if (element.src !== url) {
        element.src = cfg.src;
        element.load?.();
      }
    }
  }

  primeAmbient() {
    this.prepareAmbient();
    for (const element of [this.airplaneElement, this.birdElement]) {
      if (!element || element.paused === false) continue;
      element.volume = 0;
      const promise = element.play();
      if (promise && typeof promise.catch === "function") promise.catch(() => {});
    }
  }

  onUserInput() {
    this.userInteracted = true;
    if (this.context?.state === "suspended") this.context.resume().catch(() => {});
  }

  ensureContext() {
    if (!this.userInteracted || typeof window.AudioContext !== "function" && typeof window.webkitAudioContext !== "function") return null;
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      this.context = new Context();
      this.master = this.context.createGain();
      this.master.gain.value = this.config.master;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") this.context.resume().catch(() => {});
    return this.context;
  }

  tone(frequency, duration, type = "square", endFrequency = frequency, volume = 0.18) {
    const context = this.ensureContext();
    if (!context || !this.master) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(Math.min(0.28, volume), now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  }

  noise(duration, volume = 0.12) {
    const context = this.ensureContext();
    if (!context || !this.master) return;
    const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.setValueAtTime(Math.min(0.28, volume), context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    source.buffer = buffer;
    source.connect(gain).connect(this.master);
    source.start();
  }

  // ---- Procedural one-shots (config-driven) -------------------
  // Each one reads its parameters from audioConfig.sfx.* so balance
  // changes live in one file. Pass overrides for rare cases (e.g.
  // a louder hit during a boss attack).
  playBeer(overrides = {}) {
    const cfg = { ...this.config.sfx.beer, ...overrides };
    this.tone(cfg.frequency, cfg.duration, "square", cfg.endFrequency, cfg.volume);
  }

  playCoffee(overrides = {}) {
    const cfg = { ...this.config.sfx.coffee, ...overrides };
    this.tone(cfg.frequency, cfg.duration, "square", cfg.endFrequency, cfg.volume);
  }

  playHit(overrides = {}) {
    const cfg = { ...this.config.sfx.hit, ...overrides };
    this.tone(cfg.frequency, cfg.duration, "triangle", cfg.endFrequency, cfg.volume);
  }

  playGameOver(overrides = {}) {
    const cfg = { ...this.config.sfx.gameOver, ...overrides };
    cfg.notes.forEach((frequency, index) => {
      window.setTimeout(
        () => this.tone(frequency, cfg.stepDuration, "square", frequency * 0.8, cfg.volume),
        index * (cfg.stepGap * 1000)
      );
    });
  }

  // ---- One-shot MP3 SFX (jump) ---------------------------------
  // Every flap/tap creates a fresh Audio element so rapid taps stack
  // instead of restarting the same sample. We deliberately don't reuse
  // a single element — overlapping playback is the whole point.
  //
  // volume: optional override on top of audioConfig.sfx.jump.volume.
  playJump(overrides = {}) {
    if (typeof window === "undefined") return;
    const cfg = { ...this.config.sfx.jump, ...overrides };
    const element = new Audio();
    element.src = cfg.src;
    element.preload = "auto";
    element.volume = Math.max(0, Math.min(1, cfg.volume));
    // No .loop — one shot per tap, as specified.
    // The browser will GC the element after playback finishes; no
    // need to track references manually.
    const playPromise = element.play();
    if (playPromise && typeof playPromise.catch === "function") {
      // Browser may block playback before the first user gesture —
      // swallow the rejection silently. Subsequent taps will retry.
      playPromise.catch(() => {});
    }
  }

  // ---- Background music (long-form, looping) -------------------
  // Routing an HTMLAudioElement through a dedicated volume is the only
  // way to loop MP3 in browsers — Web Audio oscillators can't do it.
  playMusic(key = "background", volumeOverride) {
    if (typeof window === "undefined") return;
    const cfg = this.config.music[key];
    if (!cfg) {
      if (window.__DEBUG?.isAudio) console.warn(`[AudioBus] playMusic: unknown key "${key}"`);
      return;
    }
    const volume = volumeOverride !== undefined ? volumeOverride : cfg.volume;
    if (volume < 0 || volume > 1) {
      if (window.__DEBUG?.isAudio) console.warn(`[AudioBus] playMusic: volume ${volume} for "${key}" is out of range [0,1] — will be clamped`);
    }
    if (!this.musicElement) {
      this.musicElement = new Audio();
      this.musicElement.loop = cfg.loop !== false;
      this.musicElement.preload = "auto";
    }
    // Only swap src if it actually changed — re-assigning the same src
    // resets currentTime and creates a hiccup.
    if (this.musicElement.src !== new URL(cfg.src, window.location.href).href) {
      this.musicElement.src = cfg.src;
    }
    this.musicElement.volume = Math.max(0, Math.min(1, volume));
    const playPromise = this.musicElement.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  }

  stopMusic() {
    if (!this.musicElement) return;
    this.musicElement.pause();
    this.musicElement.currentTime = 0;
  }

  setMusicVolume(volume) {
    if (!this.musicElement) return;
    this.musicElement.volume = Math.max(0, Math.min(1, volume));
  }

  // ---- Airplane SFX (positional loop) --------------------------
  // The prsan airplane uses a looping airplane.mp3 whose volume ramps
  // based on the player's horizontal distance to the enemy: loud when
  // close, quiet when the plane is at the screen edge, silent off-screen.
  // Call updateAirplaneSound(x) every frame while an instance is alive.
  startAirplane(key = "airplane") {
    if (typeof window === "undefined") return;
    const cfg = this.config.ambient[key];
    if (!cfg) {
      if (window.__DEBUG?.isAudio) console.warn(`[AudioBus] startAirplane: unknown key "${key}"`);
      return;
    }
    this.prepareAmbient();
    this.airplaneMaxVolume = Math.max(0, Math.min(1, cfg.maxVolume));
    if (this.airplaneElement?.paused !== false) {
      const p = this.airplaneElement?.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  }

  // volume from 0..1 — call every frame with the plane's x position; the
  // helper maps distance-from-center to a bell-shaped gain curve.
  updateAirplaneSound(planeX, playerX, canvasWidth) {
    if (!this.airplaneElement) return;
    const center = canvasWidth / 2;
    const distanceFromCenter = Math.min(1, Math.abs(planeX - center) / (canvasWidth / 2));
    // Bell curve: loudest at distance 0.4 (plane mid-flight), quiet at edges.
    const bell = 1 - Math.pow((distanceFromCenter - 0.4) / 0.6, 2);
    const targetVolume = Math.max(0, Math.min(1, bell)) * this.airplaneMaxVolume;
    // Smooth ramp to avoid clicks/pops.
    const current = this.airplaneElement.volume;
    this.airplaneElement.volume = current + (targetVolume - current) * 0.15;
  }

  stopAirplane() {
    if (!this.airplaneElement) return;
    this.airplaneElement.pause();
    this.airplaneElement.currentTime = 0;
    this.airplaneElement.volume = 0;
  }

  silenceAirplane() {
    if (this.airplaneElement) this.airplaneElement.volume = 0;
  }

  // ---- Bird SFX (positional loop) ------------------------------
  // The crow uses the same looping-volume pattern as the airplane — a
  // separate Audio element so airplane and bird can play simultaneously.
  startBird(key = "bird") {
    if (typeof window === "undefined") return;
    const cfg = this.config.ambient[key];
    if (!cfg) {
      if (window.__DEBUG?.isAudio) console.warn(`[AudioBus] startBird: unknown key "${key}"`);
      return;
    }
    this.prepareAmbient();
    this.birdMaxVolume = Math.max(0, Math.min(1, cfg.maxVolume));
    if (this.birdElement?.paused !== false) {
      const p = this.birdElement?.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  }

  updateBirdSound(birdX, playerX, canvasWidth) {
    if (!this.birdElement) return;
    const center = canvasWidth / 2;
    const distanceFromCenter = Math.min(1, Math.abs(birdX - center) / (canvasWidth / 2));
    // Bell curve: loudest at distance 0.4 (bird mid-flight), quiet at edges.
    const bell = 1 - Math.pow((distanceFromCenter - 0.4) / 0.6, 2);
    const targetVolume = Math.max(0, Math.min(1, bell)) * this.birdMaxVolume;
    const current = this.birdElement.volume;
    this.birdElement.volume = current + (targetVolume - current) * 0.15;
  }

  stopBird() {
    if (!this.birdElement) return;
    this.birdElement.pause();
    this.birdElement.currentTime = 0;
    this.birdElement.volume = 0;
  }

  silenceBird() {
    if (this.birdElement) this.birdElement.volume = 0;
  }
}
