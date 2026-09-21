const TAU = Math.PI * 2;
const INK = '#3D4547';
const clamp = (value) => Math.max(0, Math.min(1, value));
const easeOut = (value) => 1 - (1 - clamp(value)) ** 3;

function star(ctx, x, y, outer, inner, points, rotation = 0) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = rotation + i * Math.PI / points;
    const radius = i % 2 ? inner : outer;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export const COLLISION_EFFECT_DURATION = 0.65;
// Heal floater ("+1") — green floating text spawned by the konobari pickup.
// Independent of impact effects so the visual language stays distinct:
// smoke puffs = damage, green "+1" = heal.
export const HEAL_FLOATER_DURATION = 1.2;

/** Canvas-only impact effects. No images, dependencies or health mutations. */
export class CollisionEffects {
  constructor({ maxEffects = 20 } = {}) {
    this.effects = [];
    this.maxEffects = Math.max(1, Math.floor(maxEffects) || 20);
  }

  /** Call ONCE per accepted hit, at the world-space point of contact. */
  trigger(x, y, { scale = 1, direction = -1, damage = 1, showDamage = true } = {}) {
    const hit = {
      x, y, scale, direction: direction < 0 ? -1 : 1,
      damage: Math.abs(damage), showDamage,
      age: 0, duration: COLLISION_EFFECT_DURATION,
    };
    if (this.effects.length >= this.maxEffects) {
      const removed = this.effects.shift();
      removed.age = removed.duration;
    }
    this.effects.push(hit);
    return hit;
  }

  /**
   * Spawn a green "+1" heal floater at the given world-space coordinates.
   * Rises ~32 px and fades out over HEAL_FLOATER_DURATION seconds.
   * FIFO eviction (oldest first) keeps the effects buffer bounded.
   * Independent of `trigger()` so heal and damage visuals coexist.
   */
  spawnHealFloater(x, y) {
    if (this.effects.length >= this.maxEffects) {
      const removed = this.effects.shift();
      removed.age = removed.duration;
    }
    this.effects.push({
      type: "healFloater",
      x, y,
      age: 0,
      duration: HEAL_FLOATER_DURATION,
    });
  }

  update(deltaTime) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
    for (const hit of this.effects) hit.age = Math.min(hit.duration, hit.age + deltaTime);
    this.effects = this.effects.filter((hit) => hit.age < hit.duration);
  }

  clear() {
    for (const hit of this.effects) hit.age = hit.duration;
    this.effects.length = 0;
  }

  draw(ctx) {
    for (const fx of this.effects) {
      if (fx.type === "healFloater") this.drawHealFloater(ctx, fx);
      else this.drawHit(ctx, fx);
    }
  }

  /**
   * Green "+1" rising text. Two layers: a wide, blurred halo (low alpha,
   * shadowBlur 14) and a sharp bright-green foreground on top. easeOut
   * on the rise + alpha fade so it slows as it disappears.
   */
  drawHealFloater(ctx, fx) {
    const t = clamp(fx.age / fx.duration);   // 0..1
    const rise = -32 * easeOut(t);            // pixels up
    const alpha = 1 - easeOut(t);             // 1 → 0
    const px = fx.x;
    const py = fx.y + rise;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Layer 1: blur halo — wide shadow, low-alpha green fill.
    ctx.shadowColor = "#22ff66";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "rgba(40, 220, 80, 0.35)";
    ctx.fillText("+1", px, py);

    // Layer 2: crisp foreground — no shadow, brighter green.
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#7dff9a";
    ctx.fillText("+1", px, py);

    ctx.restore();
  }

  drawHit(ctx, hit) {
    const t = hit.age;
    if (t >= hit.duration) return;
    ctx.save();
    ctx.translate(hit.x, hit.y);
    ctx.scale(hit.scale, hit.scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const alpha = ctx.globalAlpha;

    // Five expanding smoke puffs, moving away from the point of contact.
    for (let i = 0; i < 5; i++) {
      const life = clamp((t - .04 - i * .012) / .48);
      if (life <= 0 || life >= 1) continue;
      const angle = -Math.PI + i * .72;
      const distance = 9 + easeOut(life) * (18 + i % 2 * 7);
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance - life * 12 + 9;
      const size = 4 + easeOut(life) * (5 + i % 2 * 2);
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = alpha * .88 * (1 - life ** 1.7);
      ctx.fillStyle = i % 2 ? '#E4DECC' : '#BDC5BA';
      ctx.strokeStyle = '#68756E'; ctx.lineWidth = 1.2;
      // Trace only the outside of the joined circles: no lines inside the cloud.
      ctx.beginPath();
      ctx.arc(-size * .48, 0, size * .65, Math.PI * .5, Math.PI * 1.5);
      ctx.arc(0, -size * .32, size * .8, Math.PI * 1.12, Math.PI * 1.88);
      ctx.arc(size * .55, 0, size * .64, -Math.PI * .5, Math.PI * .5);
      ctx.quadraticCurveTo(0, size * .86, -size * .48, size * .65);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // A short cream-yellow burst, with a smaller cream core.
    if (t < .17) {
      const progress = clamp(t / .17);
      const radius = 14 + Math.sin(progress * Math.PI) * 12;
      ctx.globalAlpha = alpha * (1 - progress ** 2);
      ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
      ctx.fillStyle = '#E9BD67';
      star(ctx, 0, 0, radius, radius * .44, 8, -.15);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#FFF3CB';
      star(ctx, -1, -1, radius * .66, radius * .25, 8, -.15);
      ctx.fill();
    }

    // Small stars and impact dashes; trajectories are stable across frames.
    if (t < .43) {
      const life = clamp(t / .43);
      ctx.globalAlpha = alpha * (1 - life ** 1.4);
      for (let i = 0; i < 7; i++) {
        const angle = i * TAU / 7 - .65;
        const distance = 15 + easeOut(life) * (24 + i % 3 * 5);
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance + 14 * life * life;
        ctx.strokeStyle = INK; ctx.lineWidth = 1.1;
        ctx.fillStyle = i % 2 ? '#E4DECC' : '#D6A057';
        if (i % 3 === 0) {
          star(ctx, x, y, 4.5 * (1 - life * .4), 1.9, 4, angle + life * 2);
          ctx.fill(); ctx.stroke();
        } else {
          ctx.strokeStyle = i % 2 ? '#D6A057' : '#68756E';
          ctx.lineWidth = 2.6;
          ctx.beginPath(); ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(angle) * 5, y + Math.sin(angle) * 5);
          ctx.stroke();
        }
      }
    }

    // Damage is just a label. The game controls HP and invulnerability itself.
    if (hit.showDamage) {
      ctx.save();
      const progress = clamp(t / hit.duration);
      ctx.translate(-9, -40 - easeOut(progress) * 22);
      const pop = .85 + Math.sin(clamp(t / .18) * Math.PI * .5) * .2;
      ctx.scale(pop, pop);
      ctx.globalAlpha = alpha * (1 - clamp((progress - .6) / .4));
      ctx.font = '900 18px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#F3F0E3'; ctx.lineWidth = 3.5;
      ctx.fillStyle = '#B94F46';
      const label = `−${hit.damage} ♥`;
      ctx.strokeText(label, 0, 0); ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

export default CollisionEffects;
