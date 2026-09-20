// ============================================================
// audioConfig.js — central audio configuration for the game.
//
// All volume levels, sources, and looping flags live here. Audio.js and
// gameplay scripts read from this single source of truth at load time, so
// tweaking balance is a one-file edit instead of a scavenger hunt through
// every method that calls .volume =.
//
// Adding a new sound:
//   1. Drop the file under ./assets/sounds/
//   2. Add an entry under sfx / music / ambient below
//   3. Add a playX() wrapper in AudioBus if it's a one-shot, or use the
//      generic startLooping()/stopLooping() for ambient loops.
//
// Volume scale: 0.0 (silent) … 1.0 (raw MP3 amplitude). The AudioBus
// master gain is multiplied ON TOP of these per-sound volumes, so values
// here represent "relative loudness within the mix", not absolute gain.
// ============================================================

export const audioConfig = {
  // Overall bus — applied to every Web Audio oscillator + MP3 element
  // that routes through AudioBus.master. Lower this if the mix feels
  // muddy on speakers; bump it if everything is too quiet.
  master: 1.0,

  // ---- One-shot SFX (no loop, can overlap) ---------------------
  sfx: {
    // Short jump sample — fires on every player flap/tap. Each tap
    // spawns a fresh Audio element so rapid taps stack instead of
    // cutting each other off.
    jump: {
      src: "./assets/sounds/jumpSound.mp3",
      volume: 1.0,
    },

    // Procedural SFX — generated via Web Audio oscillators. No src
    // because the sample is synthesised inside AudioBus.tone().
    hit:   { frequency: 90,  endFrequency: 45, duration: 0.15, volume: 0.20 },
    beer:  { frequency: 440, endFrequency: 660, duration: 0.08, volume: 0.16 },
    coffee:{ frequency: 330, endFrequency: 250, duration: 0.08, volume: 0.16 },
    gameOver: {
      // Game-over jingle is a 4-note descending sequence — AudioBus
      // schedules each note at 140ms cadence.
      notes: [440, 350, 260, 180],
      stepDuration: 0.14,
      stepGap: 0.14,
      volume: 0.80,
    },
  },

  // ---- Background music (long-form, looping) -------------------
  music: {
    // The main in-game track. game.js calls audio.playMusic() with the
    // key "background" and an explicit volume override (0.05) so the
    // music sits well below the SFX — this 0.3 is the "default mix level"
    // used if a caller doesn't pass an override.
    background: {
      src: "./assets/sounds/gogomuck.mp3",
      volume: 0.05,
      loop: true,
    },
  },

  // ---- Ambient/positional loops (looping, distance-ramped) -----
  // These are NOT music — they're enemy SFX whose volume ramps with
  // distance from the player. AudioBus holds dedicated Audio elements
  // for each so they can overlap with music.
  ambient: {
    airplane: {
      src: "./assets/sounds/airplane.mp3",
      maxVolume: 0.25,
      loop: true,
    },
    bird: {
      src: "./assets/sounds/crow.mp3",
      maxVolume: 0.25,
      loop: true,
    },
  },
};