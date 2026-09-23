// src/debuglos.js — centralni debug switch bag za Doleti u Dido.
// Učitava se kao klasičan <script> u index.html PRIJE src/main.js,
// pa je window.__DEBUG globalno dostupan svim ES modulima bez importa.
//
// Svi flagovi defaultno false. U DevTools konzoli uključi samo ono
// što trenutno debugiraš:
//
//   __DEBUG.isColliders = true     // vidi collider okvire
//   __DEBUG.isPerfOverlay = true   // vidi live FPS overlay
//   __DEBUG.isParallax = true      // log parallax spike uzorke
//
// Svaki console.log/warn/error u kodu je sada gated:
//   if (window.__DEBUG.isX) console.log(...)
// Tako u produkciji imaš tišinu, a u debugiranju uključiš samo što te zanima.

window.__DEBUG = {
  /** Crtanje collider okvira (player, birds, airplanes, collectibles, npcs, konobari). */
  isColliders: false,
  /** Live FPS/perf overlay u gornjem lijevom kutu (drawPerfOverlay). */
  isPerfOverlay: false,
  /** [parallax-spike] log kad parallax step probije 30ms. */
  isParallax: false,
  /** Worst-of-1s hitch log ([worst 1s], [hitch↔spawn], [LONGTASK]). */
  isPerfWorst: false,
  /** Long-task observer install log ([perf-diag]). */
  isPerfDiag: false,
  /** [frame-timing] stdDev warning. */
  isFrameTiming: false,
  /** Warmup pipeline warn/info log ([warmup] *). */
  isWarmup: false,
  /** Console cheatsheet logovi (FPS cap, unknown difficulty). */
  isCheatsheet: false,
  /** main.js loading/error/elapsed logovi ([main] *). */
  isMainLoading: false,
  /** AudioBus unknown key / volume warnings ([AudioBus] *). */
  isAudio: false,
  /** Airplane spawn/hit log ([airplane] *). */
  isAirplane: false,
  /** Bird formation spawn/hit + SVG load error log ([bird] *). */
  isBird: false,
  /** Konobar (NPC konobari) collider overlay — outline + scale/cd tekst. */
  isKonobariBoxes: false,
};
