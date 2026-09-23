const SHEET_URL = new URL('../assets/images/fabo_i_pacho.png', import.meta.url).href;
const FRAME_WIDTH = 384;
const FRAME_HEIGHT = 448;
const COLUMNS = 6;
const FRAME_COUNT = 30;
const ORIGIN = {x: 192, y: 418};
const cache = new Map();
const frameCache = new Map();

function loadSheet(url) {
  if (!cache.has(url)) {
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      // PERF-FIX-TESTA — wait for full decode before resolving. Without
      // this the sheet is "loaded" but the bitmap is still being decoded
      // in the background; the first drawImage() then stalls 50–100 ms
      // waiting for decode to finish before the GPU upload can start.
      // KonobariAnimation.preload() is awaited by warmUpRender(), so
      // this fix only delays the loading screen, not gameplay.
      image.onload = async () => {
        if (image.naturalWidth !== 2304 || image.naturalHeight !== 2240) {
          reject(new Error('Sprite sheet mora biti 2304 × 2240 px.'));
          return;
        }
        try {
          await image.decode();
        } catch (e) {
          // image.decode() can reject on Safari/Firefox oddities even
          // when the image is fully decodable. Fall through to resolve —
          // the bitmap is still drawable.
        }
        resolve(image);
      };
      image.onerror = () => reject(new Error('Nije moguće učitati fabo_i_pacho.png.'));
      image.src = url;
    }).catch(error => {cache.delete(url); throw error;});
    cache.set(url, promise);
  }
  return cache.get(url);
}

function loadFrames(url) {
  if (!frameCache.has(url)) {
    frameCache.set(url, loadSheet(url).then(async (sheet) => {
      if (typeof createImageBitmap !== "function") return null;
      const frames = [];
      try {
        for (let frame = 0; frame < FRAME_COUNT; frame++) {
          const sx = frame % COLUMNS * FRAME_WIDTH;
          const sy = Math.floor(frame / COLUMNS) * FRAME_HEIGHT;
          frames.push(await createImageBitmap(sheet, sx, sy, FRAME_WIDTH, FRAME_HEIGHT));
        }
        return frames;
      } catch (error) {
        for (const frame of frames) frame.close?.();
        return null; // The original sheet remains a working fallback.
      }
    }).catch((error) => {
      frameCache.delete(url);
      throw error;
    }));
  }
  return frameCache.get(url);
}

/**
 * Konobari sprite-sheet animator — 30 transparent pre-rendered frames from
 * assets/images/fabo_i_pacho.png. Replaces the original OriginalTandem
 * class with a name that matches its actual role (NPCKonobari's
 * animation engine).
 * x/y = anchor near the wheels. deltaTime = seconds.
 * All animation is baked into the sheet, including wings and vertical floating.
 * direction -1 faces left, direction +1 reflects the complete artwork.
 */
export class KonobariAnimation {
  static preload(url = SHEET_URL) { return loadSheet(url); }
  static preloadFrames(url = SHEET_URL) { return loadFrames(url); }

  constructor(x, y, {
    scale = 0.5, direction = -1, velocityX = 0,
    fps = 20, animationSpeed = 1, playing = true,
    sheetUrl = SHEET_URL,
  } = {}) {
    this.x = x; this.y = y;
    this.scale = scale; this.direction = direction < 0 ? -1 : 1;
    this.velocityX = velocityX; this.rotation = 0;
    this.fps = fps; this.animationSpeed = animationSpeed; this.playing = playing;
    this.time = 0; this.frame = 0; this._framePhase = 0;
    this.sheet = null; this.loadError = null;
    this.frames = null;
    this.ready = Promise.all([loadSheet(sheetUrl), loadFrames(sheetUrl)]).then(([image, frames]) => {
      this.sheet = image;
      this.frames = frames;
      return true;
    }, error => {
      this.loadError = error;
      return false;
    });
  }

  update(deltaTime) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
    this.time += deltaTime;
    this.x += this.velocityX * deltaTime;
    if (!this.playing) return;
    const advance = deltaTime * this.fps * this.animationSpeed;
    if (!Number.isFinite(advance) || advance <= 0) return;
    this._framePhase = (this._framePhase + advance) % FRAME_COUNT;
    this.frame = Math.floor(this._framePhase + 1e-9) % FRAME_COUNT;
  }

  setFrame(frame) {
    if (!Number.isFinite(frame)) return this;
    this.frame = ((Math.floor(frame) % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
    this._framePhase = this.frame;
    return this;
  }

  getPose() { return {y: this.y, angle: this.rotation}; }

  getBounds() {
    // Conservative bounds over the entire animation, including wings and bobbing.
    // Konobari collider is shrunk to ~55% (35% + extra 15%) of the visible
    // sprite so the pickup feels fair to the player — the wheels/edges of
    // the sprite art don't count as contact, only the body area.
    const c = Math.cos(this.rotation), s = Math.sin(this.rotation);
    const points = [[8, 12], [378, 12], [378, 424], [8, 424]].map(([x,y]) => {
      x = (x - ORIGIN.x) * this.scale * -this.direction;
      y = (y - ORIGIN.y) * this.scale;
      return {x: this.x + x*c - y*s, y: this.y + x*s + y*c};
    });
    const rawLeft = Math.min(...points.map(p => p.x));
    const rawRight = Math.max(...points.map(p => p.x));
    const rawTop = Math.min(...points.map(p => p.y));
    const rawBottom = Math.max(...points.map(p => p.y));
    // Shrink around the centre by ~45% (× 0.5525).
    const cx = (rawLeft + rawRight) / 2;
    const cy = (rawTop + rawBottom) / 2;
    const halfW = (rawRight - rawLeft) / 2 * 0.5525;
    const halfH = (rawBottom - rawTop) / 2 * 0.5525;
    return {
      left: cx - halfW,
      right: cx + halfW,
      top: cy - halfH,
      bottom: cy + halfH,
    };
  }

  draw(ctx, viewport = null) {
    if (!this.sheet) return;
    if (viewport) {
      const b = this.getBounds();
      if (b.right < viewport.left || b.left > viewport.right ||
          b.bottom < viewport.top || b.top > viewport.bottom) return;
    }
    // Ripple efekt IZA sprite-a. Dva koncentrična kruga koji se šire iz
    // vizualnog centra spritea (anchor je kod kotača — dno spritea — pa
    // centar izračunavamo kao y - 100, otprilike sredina sprite art-a od
    // 12..424 visine). Drugi krug kasni pola perioda tako da uvijek
    // postoji barem jedan aktivni ripple — kontinuirani puls bez pauze.
    // Nestaje kad je `_pulseHidden` postavljen na true (manager to radi
    // za vrijeme hit cooldowna). `this.time` se NE incrementava kad je
    // igra pauzirana (update() se ne poziva), pa ripple prati game state.
    if (!this._pulseHidden) {
      const RIPPLE_PERIOD = 1.6; // sekunde po ciklusu
      const RIPPLE_MIN = 20;
      const RIPPLE_MAX = 90;
      const RIPPLE_BASE_ALPHA = 0.45;
      const phase = (this.time % RIPPLE_PERIOD) / RIPPLE_PERIOD; // 0..1
      // Centar: x = sprite anchor, y = malo niže od vizualnog centra
      // (anchor je kod kotača, pa centar je y - 70, između sredine i
      // donje trećine spritea).
      const cx = this.x;
      const cy = this.y - 70;

      ctx.save();
      ctx.strokeStyle = "#7dff9a";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#22ff66";
      ctx.shadowBlur = 8;

      for (let i = 0; i < 2; i++) {
        const localPhase = (phase + i * 0.5) % 1; // drugi kasni 0.5
        const radius = RIPPLE_MIN + (RIPPLE_MAX - RIPPLE_MIN) * localPhase;
        const alpha = (1 - localPhase) * RIPPLE_BASE_ALPHA;
        if (alpha <= 0.01) continue;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    const sx = this.frame % COLUMNS * FRAME_WIDTH;
    const sy = Math.floor(this.frame / COLUMNS) * FRAME_HEIGHT;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.scale(this.scale * -this.direction, this.scale);
    if (this.frames) {
      ctx.drawImage(this.frames[this.frame], -ORIGIN.x, -ORIGIN.y, FRAME_WIDTH, FRAME_HEIGHT);
    } else {
      ctx.drawImage(this.sheet, sx, sy, FRAME_WIDTH, FRAME_HEIGHT,
        -ORIGIN.x, -ORIGIN.y, FRAME_WIDTH, FRAME_HEIGHT);
    }
    ctx.restore();
  }
}

export default KonobariAnimation;
