const BIRD_VIEW_W = 840;
const BIRD_VIEW_H = 1080;

// ~20% larger than before.
const BIRD_SCALE = 0.062 * 1.2;

// Pivots in SVG viewBox coordinates.
// Fine-tune wing pivot visually if needed.
const BIRD_PIVOTS = {
  birdCenter: { x: 462, y: 520 },

  // Shoulder / attachment point on the RIGHT side of the wing.
  wing: { x: 340, y: 840 },

  leftHip: { x: 416, y: 926 },
  rightHip: { x: 292, y: 910 },
};

// --------------------------------------------------
// WING
// --------------------------------------------------

const WING_BASE_ROTATION = -0.15;
const WING_FLAP_MULTIPLIER = 0.9;
const WING_PHASE_SPEED = 12;

// How long the old sinus-style flap remains active after a tap.
const WING_ANIMATION_DURATION = 0.30;

// --------------------------------------------------
// HAT
// --------------------------------------------------

const HAT_HOP_DURATION = 0.32;

// Stronger hat animation.
const HAT_HOP_HEIGHT = 38;
const HAT_HOP_SCALE = 0.18;
const HAT_HOP_ROTATION = -0.15;

// --------------------------------------------------
// LEGS
// --------------------------------------------------

const LEG_HZ_LEFT = 1.2;
const LEG_HZ_RIGHT = 0.9;
const LEG_AMPLITUDE = 0.087; // ~5°
const LEG_PHASE_OFFSET = 1.1;

// --------------------------------------------------
// PLAYER
// --------------------------------------------------

const MAX_HP = 3;

export class Player {
  constructor(x, y, parts = null) {
    this.x = x;
    this.y = y;

    this.velocityY = 0;
    this.rotation = 0;

    this.width = 56;
    this.height = 48;

    // ------------------------------------------------
    // HEALTH
    // ------------------------------------------------

    this.hp = MAX_HP;

    // ------------------------------------------------
    // INVINCIBILITY
    // ------------------------------------------------

    this.invincibleUntil = 0;
    this.invincibilityFlashStart = 0;
    this.flashVisible = true;

    // ------------------------------------------------
    // SVG PARTS
    // ------------------------------------------------

    // Expected:
    // parts.body
    // parts.wing
    // parts.hat
    // parts.leftLeg
    // parts.rightLeg
    this.parts = parts;

    // ------------------------------------------------
    // WING ANIMATION
    // ------------------------------------------------

    this.wingPhase = 0;
    this.wingAnimating = false;
    this.wingAnimationTime = 0;

    // ------------------------------------------------
    // OTHER ANIMATIONS
    // ------------------------------------------------

    this.hatHopProgress = 0;
    this.legTime = 0;
  }

  // --------------------------------------------------
  // ASSETS
  // --------------------------------------------------

  setParts(parts) {
    this.parts = parts;
  }

  // --------------------------------------------------
  // DAMAGE / INVINCIBILITY
  // --------------------------------------------------

  canTakeDamage(nowSeconds) {
    return nowSeconds >= this.invincibleUntil;
  }

  grantInvincibility(
    nowSeconds,
    durationSeconds = 2,
    flashDelaySeconds = 0
  ) {
    this.invincibleUntil = Math.max(
      this.invincibleUntil,
      nowSeconds + durationSeconds
    );

    this.invincibilityFlashStart =
      nowSeconds + Math.max(0, flashDelaySeconds);
  }

  isInvincible(nowSeconds) {
    return nowSeconds < this.invincibleUntil;
  }

  shouldDraw(nowSeconds) {
    if (!this.parts) {
      return false;
    }

    if (nowSeconds < this.invincibleUntil) {
      if (nowSeconds < this.invincibilityFlashStart) {
        this.flashVisible = true;
        return true;
      }

      this.flashVisible =
        Math.floor((nowSeconds * 12) % 2) === 0;

      return this.flashVisible;
    }

    this.flashVisible = true;
    return true;
  }

  getOpacity(
    nowSeconds,
    {
      peakOpacity = 1,
      troughOpacity = 0.3,
      hz = 12,
    } = {}
  ) {
    if (
      nowSeconds < this.invincibleUntil &&
      nowSeconds >= this.invincibilityFlashStart
    ) {
      const phase =
        nowSeconds * hz * Math.PI * 2;

      const sine01 =
        (Math.sin(phase) + 1) / 2;

      return (
        troughOpacity +
        (peakOpacity - troughOpacity) * sine01
      );
    }

    return peakOpacity;
  }

  // --------------------------------------------------
  // RESET
  // --------------------------------------------------

  reset(x, y) {
    this.x = x;
    this.y = y;

    this.velocityY = 0;
    this.rotation = 0;

    this.hp = MAX_HP;

    this.invincibleUntil = 0;
    this.invincibilityFlashStart = 0;
    this.flashVisible = true;

    this.wingPhase = 0;
    this.wingAnimating = false;
    this.wingAnimationTime = 0;

    this.hatHopProgress = 0;
    this.legTime = 0;
  }

  // --------------------------------------------------
  // HEALTH
  // --------------------------------------------------

  takeDamage(amount = 1) {
    const now =
      performance.now() / 1000;

    if (this.isInvincible(now)) {
      return this.hp;
    }

    const damage =
      Math.max(
        0,
        Number(amount) || 0
      );

    this.hp = Math.max(
      0,
      this.hp - damage
    );

    return this.hp;
  }

  isDead() {
    return this.hp <= 0;
  }

  // --------------------------------------------------
  // FLAP / TAP
  // --------------------------------------------------

  flap() {
    // Gameplay impulse.
    this.velocityY = -390;

    // Old wing animation feel,
    // but only triggered on tap.
    this.wingPhase = Math.PI;
    this.wingAnimating = true;
    this.wingAnimationTime = 0;

    // Hat animation starts on the same tap.
    this.hatHopProgress = 1;
  }

  // --------------------------------------------------
  // UPDATE
  // --------------------------------------------------

  update(deltaTime) {
    const gravity = 1040;

    // ----------------------------------------------
    // PHYSICS
    // ----------------------------------------------

    this.velocityY +=
      gravity * deltaTime;

    this.velocityY = Math.min(
      this.velocityY,
      570
    );

    this.y +=
      this.velocityY * deltaTime;

    this.rotation = Math.max(
      -0.42,
      Math.min(
        0.72,
        this.velocityY / 650
      )
    );

    // ----------------------------------------------
    // LEGS
    // ----------------------------------------------

    this.legTime += deltaTime;

    // ----------------------------------------------
    // WING
    // ----------------------------------------------

    if (this.wingAnimating) {
      this.wingPhase +=
        deltaTime * WING_PHASE_SPEED;

      this.wingAnimationTime +=
        deltaTime;

      if (
        this.wingAnimationTime >=
        WING_ANIMATION_DURATION
      ) {
        this.wingAnimating = false;
        this.wingAnimationTime = 0;
      }
    }

    // ----------------------------------------------
    // HAT
    // ----------------------------------------------

    if (this.hatHopProgress > 0) {
      this.hatHopProgress = Math.max(
        0,
        this.hatHopProgress -
          deltaTime / HAT_HOP_DURATION
      );
    }
  }

  // --------------------------------------------------
  // COLLISION
  // --------------------------------------------------

  getBounds() {
    return {
      left:
        this.x -
        this.width * 0.32,

      right:
        this.x +
        this.width * 0.32,

      top:
        this.y -
        this.height * 0.30,

      bottom:
        this.y +
        this.height * 0.30,
    };
  }

  // --------------------------------------------------
  // SVG PART RENDERING
  // --------------------------------------------------

  drawPart(
    context,
    partKey,
    pivotX = 0,
    pivotY = 0,
    localRotation = 0
  ) {
    const part =
      this.parts?.[partKey];

    if (!part) {
      return;
    }

    context.save();

    if (localRotation !== 0) {
      context.translate(
        pivotX,
        pivotY
      );

      context.rotate(
        localRotation
      );

      context.translate(
        -pivotX,
        -pivotY
      );
    }

    context.drawImage(
      part,
      0,
      0,
      BIRD_VIEW_W,
      BIRD_VIEW_H
    );

    context.restore();
  }

  // --------------------------------------------------
  // DRAW
  // --------------------------------------------------

  draw(context) {
    if (!this.parts) {
      return;
    }

    const now =
      performance.now() / 1000;

    const opacity =
      this.getOpacity(now);

    context.save();

    // ==================================================
    // WHOLE BIRD
    // ==================================================

    context.translate(
      this.x,
      this.y
    );

    context.rotate(
      this.rotation
    );

    context.scale(
      BIRD_SCALE,
      BIRD_SCALE
    );

    context.translate(
      -BIRD_PIVOTS.birdCenter.x,
      -BIRD_PIVOTS.birdCenter.y
    );

    context.globalAlpha =
      opacity;

    // ==================================================
    // LEGS
    // ==================================================

    const leftLegAngle =
      Math.sin(
        this.legTime *
          LEG_HZ_LEFT *
          Math.PI *
          2
      ) *
      LEG_AMPLITUDE;

    const rightLegAngle =
      Math.sin(
        this.legTime *
          LEG_HZ_RIGHT *
          Math.PI *
          2 +
          LEG_PHASE_OFFSET
      ) *
      LEG_AMPLITUDE;

    this.drawPart(
      context,
      "leftLeg",
      BIRD_PIVOTS.leftHip.x,
      BIRD_PIVOTS.leftHip.y,
      leftLegAngle
    );

    this.drawPart(
      context,
      "rightLeg",
      BIRD_PIVOTS.rightHip.x,
      BIRD_PIVOTS.rightHip.y,
      rightLegAngle
    );

    // ==================================================
    // HAT (drawn above legs, below body — so the body
    // silhouette occludes the hat where they overlap)
    // ==================================================

    if (this.parts.hat) {
      const hatT =
        1 - this.hatHopProgress;

      const hatImpulse =
        this.hatHopProgress > 0
          ? Math.sin(hatT * Math.PI)
          : 0;

      const hopY =
        -hatImpulse *
        HAT_HOP_HEIGHT;

      const hopScale =
        1 +
        hatImpulse *
          HAT_HOP_SCALE;

      const hopRotation =
        hatImpulse *
        HAT_HOP_ROTATION;

      context.save();

      context.translate(
        BIRD_PIVOTS.birdCenter.x,
        BIRD_PIVOTS.birdCenter.y
      );

      context.translate(
        0,
        hopY
      );

      context.rotate(
        hopRotation
      );

      context.scale(
        hopScale,
        hopScale
      );

      context.translate(
        -BIRD_PIVOTS.birdCenter.x,
        -BIRD_PIVOTS.birdCenter.y
      );

      context.drawImage(
        this.parts.hat,
        0,
        0,
        BIRD_VIEW_W,
        BIRD_VIEW_H
      );

      context.restore();
    }

    // ==================================================
    // BODY
    // ==================================================

    this.drawPart(
      context,
      "body"
    );

    // ==================================================
    // WING (top layer — flap sweeps over body and hat)
    // ==================================================

    let wingAngle =
      WING_BASE_ROTATION;

    if (this.wingAnimating) {
      const flap =
        Math.sin(this.wingPhase);

      wingAngle =
        WING_BASE_ROTATION +
        flap *
          WING_FLAP_MULTIPLIER;
    }

    this.drawPart(
      context,
      "wing",
      BIRD_PIVOTS.wing.x,
      BIRD_PIVOTS.wing.y,
      wingAngle
    );

    context.globalAlpha = 1;

    context.restore();
  }
}