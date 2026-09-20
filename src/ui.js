const HEALTH_HEART_COUNT = 3;

export class GameUI {
  constructor() {
    this.startScreen = document.querySelector("#start-screen");
    this.gameOverScreen = document.querySelector("#game-over-screen");
    this.hud = document.querySelector("#hud");
    this.touchPrompt = document.querySelector("#touch-prompt");
    this.pauseOverlay = document.querySelector("#pause-overlay");

    // Loading screen — shown until parallax PNGs and the bird SVG have both
    // been fetched and decoded. Owned by main.js: it calls showLoading() before
    // constructing Game, then hideLoading() (or hideLoadingImmediate() on a
    // warm-cache fast path) once Game.whenReady() resolves.
    this.loadingScreen = document.querySelector("#loading-screen");

    this.beerValue = document.querySelector("#beer-value");
    this.coffeeValue = document.querySelector("#coffee-value");
    this.healthHearts = [...document.querySelectorAll(".health-heart")];
    this.finalScore = document.querySelector("#final-score");
    this.finalBeers = document.querySelector("#final-beers");
    this.playButton = document.querySelector("#play-button");

    // Cached DOM state — the UI is only written when a value actually
    // changes. Touching textContent or classList on every frame costs
    // real time on the main thread, especially with `toLocaleString`.
    this.lastBeerText = "";
    this.lastCoffeeText = "";
    this.lastHealth = -1;
  }

  bindActions(onPlay, onReplay) {
    this.playButton.addEventListener("click", onPlay);
    document.querySelector("#replay-button").addEventListener("click", onReplay);
  }

  showLoading() {
    // Loading screen is visible by default (no `hidden` attribute) so the
    // user sees the bird image the moment the HTML parses, before any JS
    // runs. Re-show it here too in case showStart/showGameOver hid it.
    if (this.loadingScreen) {
      this.loadingScreen.hidden = false;
      this.loadingScreen.classList.remove("is-leaving");
    }
    // Hide every other screen so nothing competes with the loading overlay
    // for the user's eye. We don't bother hiding the HUD — it already has
    // `hidden` set in HTML and only showPlaying() ever reveals it.
    this.startScreen.hidden = true;
    this.gameOverScreen.hidden = true;
    this.hidePaused();
    // Hide the start screen's "UČITAVANJE…" state too — the dedicated overlay
    // is a better signal than a disabled button.
    if (typeof this.setBackgroundLoading === "function") {
      this.setBackgroundLoading(false);
    }
  }

  /**
   * Hides the loading overlay immediately, no fade. Used on the warm-cache
   * path in main.js where the user already saw the loading screen for
   * <300 ms — a 320 ms fade on top of that would feel laggy, but the
   * overlay MUST still be removed (its z-index:20 would otherwise cover
   * the start screen's z-index:10 and block the "IGRAJ" tap).
   */
  hideLoadingImmediate() {
    if (!this.loadingScreen) return;
    this.loadingScreen.classList.remove("is-leaving");
    this.loadingScreen.hidden = true;
  }

  /**
   * Switches the loading screen from "loading…" to "tap to continue".
   * The same DOM element stays on screen — only the visible text and
   * the bird pulse animation change. main.js listens for the user's
   * first input and then calls hideLoadingImmediate() + showStart().
   *
   * Called from main.js after game.whenReady() resolves. The loading
   * screen never visibly disappears here; only its state changes.
   */
  showTapToContinue() {
    if (!this.loadingScreen) return;
    // Remove any pending fade-out so the screen stays fully opaque.
    this.loadingScreen.classList.remove("is-leaving");
    // .is-tap toggles the CSS rules that hide "loading", show "tap",
    // and pulse the bird image. Without it the screen looks identical
    // to the still-loading state.
    this.loadingScreen.classList.add("is-tap");
  }

  /**
   * True while the loading screen is showing the "tap" prompt (i.e. the
   * world is loaded but the user hasn't dismissed it yet). main.js uses
   * this to decide whether to interpret the next pointer/key event as
   * "dismiss the tap screen" vs "start the game".
   */
  isTapToContinue() {
    if (!this.loadingScreen) return false;
    if (this.loadingScreen.hidden) return false;
    return this.loadingScreen.classList.contains("is-tap");
  }

  async hideLoading() {
    if (!this.loadingScreen) return;
    // Mark as leaving so the CSS opacity transition runs, then detach from
    // the layout after the transition. Without the timeout the user sees a
    // hard pop the instant we set hidden=true.
    if (this.loadingScreen.hidden) return;
    this.loadingScreen.classList.add("is-leaving");
    await new Promise((resolve) => setTimeout(resolve, 320));
    this.loadingScreen.hidden = true;
    this.loadingScreen.classList.remove("is-leaving");
  }

  showOfflineToast(message = "Učitavam offline scenu") {
    // Lightweight, non-blocking toast for the case where the parallax JSON
    // failed to load and we fell back to the procedural scene after 5 s.
    // A single instance is reused — no DOM thrash, no memory leak risk.
    let toast = document.querySelector("#offline-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "offline-toast";
      toast.className = "offline-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.querySelector(".game-shell")?.appendChild(toast);
    }
    toast.textContent = message;
    // Force a reflow before toggling the visible class so the
    // fade-in transition runs even if the toast was already in the DOM.
    toast.classList.remove("is-visible");
    void toast.offsetWidth;
    toast.classList.add("is-visible");
    clearTimeout(toast.__hideTimer);
    toast.__hideTimer = setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 5000);
  }

  showStart() {
    this.startScreen.hidden = false;
    this.gameOverScreen.hidden = true;
    this.hud.hidden = true;
    this.touchPrompt.hidden = true;
    this.hidePaused();
  }

  setBackgroundLoading(loading, failed = false) {
    this.playButton.disabled = loading || failed;
    if (failed) {
      this.playButton.querySelector("span").textContent = "POZADINA NIJE DOSTUPNA";
    } else if (loading) {
      this.playButton.querySelector("span").textContent = "UČITAVANJE…";
    } else {
      this.playButton.querySelector("span").textContent = "IGRAJ";
    }
    this.playButton.setAttribute("aria-busy", loading ? "true" : "false");
  }

  showPlaying() {
    this.startScreen.hidden = true;
    this.gameOverScreen.hidden = true;
    this.hud.hidden = false;
    this.touchPrompt.hidden = false;
    window.setTimeout(() => {
      this.touchPrompt.hidden = true;
    }, 2200);
  }

  showPaused() {
    this.pauseOverlay.hidden = false;
  }

  hidePaused() {
    this.pauseOverlay.hidden = true;
  }

  showGameOver({ score, beers, coffees }) {
    this.hidePaused();
    this.hud.hidden = true;
    this.touchPrompt.hidden = true;
    this.gameOverScreen.hidden = false;
    if (this.finalScore) this.finalScore.textContent = score.toLocaleString("hr-HR");
    if (this.finalBeers) this.finalBeers.textContent = beers.toString();
    const finalCoffees = document.querySelector("#final-coffees");
    if (finalCoffees) finalCoffees.textContent = (coffees ?? 0).toString();
    document.querySelector("#replay-button").focus({ preventScroll: true });
    // Reset cached values so the next update() repaints them.
    this.lastBeerText = "";
    this.lastCoffeeText = "";
    this.lastHealth = -1;
  }

  update({ beers, coffees = 0, health = HEALTH_HEART_COUNT }) {
    const beerText = beers.toString();
    if (beerText !== this.lastBeerText) {
      this.beerValue.textContent = beerText;
      this.lastBeerText = beerText;
    }
    const coffeeText = coffees.toString();
    if (coffeeText !== this.lastCoffeeText) {
      if (this.coffeeValue) this.coffeeValue.textContent = coffeeText;
      this.lastCoffeeText = coffeeText;
    }
    if (health !== this.lastHealth) {
      for (let index = 0; index < this.healthHearts.length; index += 1) {
        this.healthHearts[index].classList.toggle("lost", index >= health);
      }
      this.lastHealth = health;
    }
  }
}
