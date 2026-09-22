// Enemy bird — side-view crow assembled from SVG parts (farWing, nearWing,
// tail, feet, body, head). Drawing pattern is modelled on Player so the
// same AssetLoader.loadSvgParts() pipeline that renders the player also
// renders the bird (proven working path). The only differences from the
// player are:
//   - the bird is positioned by spawner (x/y + velocity), not by gravity
//   - a one-second flap() burst adds a brief overshoot on top of the
//     steady sin sweep so the bird visibly reacts to entering the screen
//   - direction: -1 flips the sprite horizontally so the bird faces the
//     way it flies (head points left when flying left)

const ENEMY_BIRD_VIEW_W = 640;
const ENEMY_BIRD_VIEW_H = 560;

// ---------------------------------------------------------------------------
// CONFIG — single tuning point. To retune the bird at runtime call
// setConfig({ wingSpeed: ... }) from outside; values are clamped via
// LIMITS so a stray JSON value can't spin the wings into oblivion.
// Angle unit throughout is DEGREES — only draw() converts to radians.
// ---------------------------------------------------------------------------
const DEFAULTS = Object.freeze({
  wingSpeed: 10.8,        // flaps/sec — sin() frequency multiplier on time
  wingAmplitude: 15,      // degrees — peak deviation from baseWingAngle
  baseWingAngle: -20,     // degrees — neutral wing tilt
  pivotX: 400,            // SVG viewBox coord — near-wing shoulder
  pivotY: 337,
  farPivotX: 410,         // SVG viewBox coord — far-wing shoulder
  farPivotY: 330,
  bodyBobAmount: 5,       // px — peak vertical sway
  bodyBobSpeed: 4.5,      // sway cycles per second
});

// Hard caps so setConfig() never produces extreme values even if the
// caller passes a stray JSON blob.
const LIMITS = Object.freeze({
  wingSpeed: [0, 24],
  wingAmplitude: [0, 85],
  baseWingAngle: [-90, 60],
  pivotX: [0, 640],
  pivotY: [0, 560],
  farPivotX: [0, 640],
  farPivotY: [0, 560],
  bodyBobAmount: [0, 30],
  bodyBobSpeed: [0, 16],
});

function clamp(value, [min, max]) {
  return Math.max(min, Math.min(max, value));
}

function normalizeConfig(values = {}) {
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const raw = values[key];
    const value = Number.isFinite(raw) ? raw : fallback;
    out[key] = clamp(value, LIMITS[key]);
  }
  return out;
}

// birdCenter is where the whole sprite's local origin lands — (0, 0) after
// the draw() translate. Tuned to the visual centre of the torso so the
// body doesn't drift off-axis when wings rotate.
const ENEMY_BIRD_PIVOTS = Object.freeze({
  birdCenter: { x: 462, y: 470 },
});

// Visible silhouette spans roughly x ∈ [180, 720], y ∈ [225, 605] in SVG
// coordinates. We keep the same proportions but shrink both axes by 0.7
// so the hitbox is fairer than the visual outline — same approach as the
// airplane.
const ENEMY_BIRD_HITBOX = Object.freeze({
  left: -250,
  right: 70,
  top: -345,
  bottom: -50,
});

// Burst on spawn — one-second sine²·sin(2·) sweep that adds extra wing
// motion the first second of life, then fades out.
const FLAP_BURST_DURATION = 1.0; // seconds
const FLAP_BURST_AMPLITUDE = 24; // degrees at the burst peak

export class EnemyBird {
  constructor(x, y, { scale = 0.19, direction = -1, velocityX = 0 } = {}) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.direction = direction < 0 ? -1 : 1;
    this.velocityX = velocityX;
    this.rotation = 0;
    this.time = 0;
    // flapAge tracks seconds since the last flap() call. Infinity means
    // "no flap yet" so the burst branch in getPose() stays dormant.
    this.flapAge = Infinity;
    this.config = normalizeConfig({});
    // Parts are injected by the spawner once AssetLoader.loadSvgParts()
    // resolves. Until then draw() is a no-op.
    this.parts = null;
  }

  setParts(parts) {
    this.parts = parts;
  }

  setConfig(values) {
    this.config = normalizeConfig({ ...this.config, ...values });
  }

  update(deltaTime) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
    this.time += deltaTime;
    this.x += this.velocityX * deltaTime;
    if (Number.isFinite(this.flapAge)) {
      this.flapAge += deltaTime;
    }
  }

  flap() {
    this.flapAge = 0;
  }

  resetAnimation() {
    this.time = 0;
    this.flapAge = Infinity;
  }

  getPose() {
    const c = this.config;
    const age = this.flapAge;

    // Burst — a one-second sweep added on top of the steady flap. sin²·sin
    // gives a quick rise, brief overshoot, then a smooth fade. Stays zero
    // when flapAge is Infinity (no flap yet) or beyond FLAP_BURST_DURATION.
    const burst =
      age >= 0 && age < FLAP_BURST_DURATION
        ? Math.sin(Math.PI * age) ** 2 *
          Math.sin(2 * Math.PI * age) *
          FLAP_BURST_AMPLITUDE
        : 0;

    const wingAngle =
      c.baseWingAngle +
      Math.sin(this.time * c.wingSpeed) * c.wingAmplitude +
      burst;

    return {
      // Same shape as EnemyAirplane.getPose() so getBounds() and the
      // transform stack can share a single pose object.
      y: this.y + Math.sin(this.time * c.bodyBobSpeed) * c.bodyBobAmount * this.scale,
      angle: this.rotation + Math.sin(this.time * 1.7) * 0.025,
      // Wing angles are extra fields on the same object so draw() can
      // grab them without a second call. Body bob is in *viewBox* pixels
      // — draw() applies it inside the scaled frame.
      wingAngle,
      bob: Math.sin(this.time * c.bodyBobSpeed) * c.bodyBobAmount,
    };
  }

  getBounds() {
    const pose = this.getPose();
    const cos = Math.cos(pose.angle);
    const sin = Math.sin(pose.angle);
    const shrink = 0.7;
    const corners = [
      [ENEMY_BIRD_HITBOX.left, ENEMY_BIRD_HITBOX.top],
      [ENEMY_BIRD_HITBOX.right, ENEMY_BIRD_HITBOX.top],
      [ENEMY_BIRD_HITBOX.right, ENEMY_BIRD_HITBOX.bottom],
      [ENEMY_BIRD_HITBOX.left, ENEMY_BIRD_HITBOX.bottom],
    ].map(([x, y]) => {
      x *= this.scale * this.direction * shrink;
      y *= this.scale * shrink;
      return {
        x: this.x + x * cos - y * sin,
        y: pose.y + x * sin + y * cos,
      };
    });
    return {
      left: Math.min(...corners.map((p) => p.x)),
      right: Math.max(...corners.map((p) => p.x)),
      top: Math.min(...corners.map((p) => p.y)),
      bottom: Math.max(...corners.map((p) => p.y)),
    };
  }

  // Mirrors Player.drawPart — the whole bird sits in the (0,0)-(640,560)
  // viewBox frame, draw() handles the global translate/scale, drawPart
  // only does the optional rotation around a local pivot.
  drawPart(ctx, partKey, pivotX = 0, pivotY = 0, localRotationDeg = 0) {
    const part = this.parts?.[partKey];
    if (!part) return;

    ctx.save();
    if (localRotationDeg !== 0) {
      ctx.translate(pivotX, pivotY);
      ctx.rotate((localRotationDeg * Math.PI) / 180);
      ctx.translate(-pivotX, -pivotY);
    }
    // Source rect = full viewBox; dest rect = (0,0,640,560) inside the
    // already-translated/scaled frame so the part lands in the same world
    // coordinates as the player bird does.
    ctx.drawImage(part, 0, 0, ENEMY_BIRD_VIEW_W, ENEMY_BIRD_VIEW_H);
    ctx.restore();
  }

  draw(ctx) {
    if (!this.parts) return;

    const pose = this.getPose();
    const c = this.config;

    ctx.save();

    // Same transform stack as Player.draw — translate to world pos, scale
    // by per-instance size (with direction flip), then shift the viewBox
    // origin to birdCenter so the sprite is centred on (this.x, this.y).
    ctx.translate(this.x, pose.y);
    ctx.rotate(this.rotation);
    ctx.scale(this.scale * this.direction, this.scale);
    ctx.translate(0, pose.bob);
    ctx.translate(
      -ENEMY_BIRD_PIVOTS.birdCenter.x,
      -ENEMY_BIRD_PIVOTS.birdCenter.y,
    );

    // Layer order matches the SVG authoring order so the far wing sits
    // behind the torso and the near wing sweeps over it.
    this.drawPart(ctx, "feet");
    this.drawPart(ctx, "tail");
    this.drawPart(
      ctx,
      "farWing",
      c.farPivotX,
      c.farPivotY,
      pose.wingAngle,
    );
    this.drawPart(ctx, "body");
    this.drawPart(ctx, "head");
    this.drawPart(
      ctx,
      "nearWing",
      c.pivotX,
      c.pivotY,
      pose.wingAngle,
    );

    ctx.restore();
  }
}

export default EnemyBird;