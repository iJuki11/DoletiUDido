import { KonobariAnimation } from "./konobariAnimation.js";

/**
 * NPCKonobari — friendly sprite-sheet NPC. Walks left or right across the
 * screen with a randomly chosen y. Touching the player grants +1 HP (capped
 * by Player.MAX_HP) and despawns the instance. No damage, no game-over
 * pressure — purely a pickup-style ally.
 *
 * Public API mirrors the other NPCs (NPCPrsan, NPCNidjo, NPCToni):
 * update(deltaTime), draw(ctx), getBounds(). The underlying sprite-sheet
 * animation is delegated to KonobariAnimation.
 *
 * x/y = anchor near the wheels (same convention as the sprite animation).
 * direction: +1 right, -1 left. deltaTime: seconds. velocityX: pixels/second.
 */
export class NPCKonobari {
  constructor(x, y, {
    scale = 0.5, direction = 1, velocityX = 0,
  } = {}) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.direction = direction < 0 ? -1 : 1;
    this.velocityX = velocityX;
    this.rotation = 0;

    this.animation = new KonobariAnimation(x, y, {
      scale,
      direction,
      velocityX,
    });
  }

  update(deltaTime) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
    this.animation.update(deltaTime);
    // Keep wrapper coords in sync with the animation in case callers inspect
    // them (e.g. for spawn / despawn logic in the manager).
    this.x = this.animation.x;
    this.y = this.animation.y;
  }

  draw(ctx) {
    this.animation.draw(ctx);
  }

  getBounds() {
    return this.animation.getBounds();
  }
}

export default NPCKonobari;
