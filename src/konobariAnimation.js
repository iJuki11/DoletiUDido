const SHEET_URL = new URL('../assets/images/fabo_i_pacho.png', import.meta.url).href;
const FRAME_WIDTH = 384;
const FRAME_HEIGHT = 448;
const COLUMNS = 6;
const FRAME_COUNT = 30;
const ORIGIN = {x: 192, y: 418};
const cache = new Map();

function loadSheet(url) {
  if (!cache.has(url)) {
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (image.naturalWidth !== 2304 || image.naturalHeight !== 2240) {
          reject(new Error('Sprite sheet mora biti 2304 × 2240 px.'));
        } else resolve(image);
      };
      image.onerror = () => reject(new Error('Nije moguće učitati fabo_i_pacho.png.'));
      image.src = url;
    }).catch(error => {cache.delete(url); throw error;});
    cache.set(url, promise);
  }
  return cache.get(url);
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

  constructor(x, y, {
    scale = 0.8, direction = -1, velocityX = 0,
    fps = 20, animationSpeed = 1, playing = true,
    sheetUrl = SHEET_URL,
  } = {}) {
    this.x = x; this.y = y;
    this.scale = scale; this.direction = direction < 0 ? -1 : 1;
    this.velocityX = velocityX; this.rotation = 0;
    this.fps = fps; this.animationSpeed = animationSpeed; this.playing = playing;
    this.time = 0; this.frame = 0; this._framePhase = 0;
    this.sheet = null; this.loadError = null;
    this.ready = loadSheet(sheetUrl).then(image => {
      this.sheet = image;
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
    const c = Math.cos(this.rotation), s = Math.sin(this.rotation);
    const points = [[8, 12], [378, 12], [378, 424], [8, 424]].map(([x,y]) => {
      x = (x - ORIGIN.x) * this.scale * -this.direction;
      y = (y - ORIGIN.y) * this.scale;
      return {x: this.x + x*c - y*s, y: this.y + x*s + y*c};
    });
    return {
      left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
      top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)),
    };
  }

  draw(ctx, viewport = null) {
    if (!this.sheet) return;
    if (viewport) {
      const b = this.getBounds();
      if (b.right < viewport.left || b.left > viewport.right ||
          b.bottom < viewport.top || b.top > viewport.bottom) return;
    }
    const sx = this.frame % COLUMNS * FRAME_WIDTH;
    const sy = Math.floor(this.frame / COLUMNS) * FRAME_HEIGHT;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.scale(this.scale * -this.direction, this.scale);
    ctx.drawImage(this.sheet, sx, sy, FRAME_WIDTH, FRAME_HEIGHT,
      -ORIGIN.x, -ORIGIN.y, FRAME_WIDTH, FRAME_HEIGHT);
    ctx.restore();
  }
}

export default KonobariAnimation;
