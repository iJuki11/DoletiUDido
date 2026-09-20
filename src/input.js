export class InputController {
  constructor(target) {
    this.target = target;
    this.flapRequested = false;
    this.pauseRequested = false;
    this.enabled = false;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);

    target.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
  }

  onPointerDown(event) {
    if (!this.enabled) return;
    event.preventDefault();
    this.flapRequested = true;
  }

  onKeyDown(event) {
    if (!this.enabled || event.repeat) return;
    if (event.code === "Escape" || event.code === "KeyP" || event.key === "p" || event.key === "P") {
      event.preventDefault();
      this.pauseRequested = true;
      return;
    }
    if (event.code === "Space" || event.code === "ArrowUp") {
      event.preventDefault();
      this.flapRequested = true;
    }
  }

  consumeFlap() {
    if (!this.flapRequested) return false;
    this.flapRequested = false;
    return true;
  }

  consumePause() {
    if (!this.pauseRequested) return false;
    this.pauseRequested = false;
    return true;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.flapRequested = false;
    this.pauseRequested = false;
  }
}
