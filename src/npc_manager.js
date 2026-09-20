// NPCManager — orchestrates all non-enemy, atmospheric characters.
//
// A NPC (Non-Player Character) here means anything that floats, drifts,
// or otherwise populates the world but does NOT damage the player. This is
// the home for visual flavour: paratroopers, balloons, debris, etc.
//
// Design rules followed by every sub-manager:
//   - one method, one responsibility
//   - sub-managers expose: update(), draw(), reset()
//   - active instances live in `instances[]` and are ticked every frame
//   - spawn gating: at most one active instance per type at a time
//   - timers and randomness stay inside the sub-manager, not in the parent

import { NPCPrsan } from "./npc_prsan.js";
import { NPCNidjo } from "./npc_nidjo.js";
import { NPCToni } from "./npc_toni.js";
import { NPCKonobari } from "./npc_konobari.js";

/**
 * Sub-manager for the "prsan" paratrooper NPC.
 *
 * Owns its own spawn timer, gust timer, and the array of active prsan
 * instances. The outer NPCManager just delegates update/draw/reset here.
 */
export class NPCPrsanManager {
  constructor({
    minInterval = 5,
    maxInterval = 15,
    spawnPadding = 80,
    spawnAboveScreen = 60,
    despawnBelow = 80,
    minFallSpeed = 22,
    maxFallSpeed = 42,
    minDrift = -14,
    maxDrift = 14,
    gustChance = 0.35,
    gustIntervalMin = 1.6,
    gustIntervalMax = 4.2,
  } = {}) {
    // Settings are stored individually so each has a clear purpose — easier
    // to tweak from the outside or feed from config later.
    this.minInterval = minInterval;
    this.maxInterval = maxInterval;
    this.spawnPadding = spawnPadding;
    this.spawnAboveScreen = spawnAboveScreen;
    this.despawnBelow = despawnBelow;
    this.minFallSpeed = minFallSpeed;
    this.maxFallSpeed = maxFallSpeed;
    this.minDrift = minDrift;
    this.maxDrift = maxDrift;
    this.gustChance = gustChance;
    this.gustIntervalMin = gustIntervalMin;
    this.gustIntervalMax = gustIntervalMax;

    this.instances = [];

    // Initialise both timers so the first frame has predictable state.
    this.scheduleNext();
    this.scheduleGust();
  }

  /** Roll a random duration until the next spawn attempt. */
  scheduleNext() {
    const span = Math.max(0, this.maxInterval - this.minInterval);
    this.nextSpawn = this.minInterval + Math.random() * span;
  }

  /** Roll a random duration until the next gust impulse. */
  scheduleGust() {
    const span = Math.max(0, this.gustIntervalMax - this.gustIntervalMin);
    this.nextGust = this.gustIntervalMin + Math.random() * span;
  }

  /**
   * Create one prsan instance with randomised descent parameters.
   * Returns the new instance so callers (tests, debug overlays) can grab it.
   */
  spawnOne(width, height) {
    const x = this.spawnPadding + Math.random() * Math.max(1, width - this.spawnPadding * 2);
    const y = -this.spawnAboveScreen;
    const fallSpeed = this.minFallSpeed + Math.random() * (this.maxFallSpeed - this.minFallSpeed);
    const drift = this.minDrift + Math.random() * (this.maxDrift - this.minDrift);
    const scale = 0.55 + Math.random() * 0.15;

    const prsan = new NPCPrsan(x, y, {
      scale,
      fallSpeed,
      velocityX: drift,
    });
    this.instances.push(prsan);
    return prsan;
  }

  /** Tick timers and walk every active instance forward by deltaTime. */
  update(deltaTime, width, height) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;

    this.timer = (this.timer || 0) + deltaTime;

    // Spawn gate: at most one prsan alive at a time. The original brief
    // asked for this so the screen doesn't fill up with parachutes.
    if (this.instances.length === 0 && this.timer >= this.nextSpawn) {
      this.timer = 0;
      this.scheduleNext();
      this.scheduleGust();
      this.spawnOne(width, height);
    }

    // Step every instance, then drop any that have drifted past the bottom.
    for (const prsan of this.instances) {
      prsan.update(deltaTime);
    }
    this.despawnIfOffscreen(height);
    this.applyRandomGust(deltaTime);
  }

  /** Remove any instance whose pose has fallen below the visible canvas. */
  despawnIfOffscreen(height) {
    this.instances = this.instances.filter(
      (prsan) => prsan.y < height + this.despawnBelow,
    );
  }

  /** Occasionally nudge an active prsan with a short wind gust. */
  applyRandomGust(deltaTime) {
    if (this.instances.length === 0) return;
    this.nextGust -= deltaTime;
    if (this.nextGust <= 0) {
      if (Math.random() < this.gustChance) {
        const strength = (Math.random() - 0.5) * 2; // -1..+1
        this.instances[0].puff(strength);
      }
      this.scheduleGust();
    }
  }

  /** Render every active instance via its own draw method. */
  draw(context) {
    for (const prsan of this.instances) {
      prsan.draw(context);
    }
  }

  /** Wipe all instances and reset timers — called on game restart. */
  reset() {
    this.instances = [];
    this.timer = 0;
    this.nextGust = 0;
    this.scheduleNext();
    this.scheduleGust();
  }
}

/**
 * Sub-manager for the "nidjo" car NPC — drives across the ground from one
 * side of the screen to the other, then despawns. At most one active
 * instance at a time (keeps the road from looking like a motorway).
 *
 * Owns its own spawn timer. The outer NPCManager just delegates
 * update/draw/reset here. Direction (+1/-1) is randomised on every spawn
 * so traffic alternates naturally; speed is randomised in [minSpeed, maxSpeed].
 *
 * y is passed in from game.js via the groundY argument of update() and is
 * resolved to the chassis origin by subtracting the visible axle offset
 * (WHEEL_RADIUS * scale, matching NPCNidjo's coordinate convention).
 */
export class NPCNidjoManager {
  constructor({
    minInterval = 8,
    maxInterval = 18,
    spawnMargin = 120,
    minSpeed = 120,
    maxSpeed = 180,
  } = {}) {
    this.minInterval = minInterval;
    this.maxInterval = maxInterval;
    this.spawnMargin = spawnMargin;
    this.minSpeed = minSpeed;
    this.maxSpeed = maxSpeed;

    this.instances = [];
    this.scheduleNext();
  }

  /** Roll a random duration until the next spawn attempt. */
  scheduleNext() {
    const span = Math.max(0, this.maxInterval - this.minInterval);
    this.nextSpawn = this.minInterval + Math.random() * span;
  }

  /**
   * Create one nidjo instance: randomised direction (left or right), random
   * forward speed in [minSpeed, maxSpeed], driving across the ground line.
   * Returns the new instance so callers (tests, debug overlays) can grab it.
   */
  spawnOne(width, groundY) {
    const scale = 0.55;
    // -1 or +1 with equal probability — alternating traffic both ways.
    const direction = Math.random() < 0.5 ? -1 : 1;
    const speed = this.minSpeed + Math.random() * (this.maxSpeed - this.minSpeed);
    // Spawn just off the appropriate edge with a small margin so the car
    // doesn't pop into existence fully on-screen.
    const x = direction > 0
      ? -this.spawnMargin
      : width + this.spawnMargin;
    // Chassis origin sits WHEEL_RADIUS (=31 in NPCNidjo) above the ground.
    const y = groundY + 75 * scale;

    const car = new NPCNidjo(x, y, {
      scale,
      direction,
      velocityX: direction * speed,
      wheelSpeed: speed,
    });
    this.instances.push(car);
    return car;
  }

  /** Tick timers and walk every active instance forward by deltaTime. */
  update(deltaTime, width, height, groundY) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;

    this.timer = (this.timer || 0) + deltaTime;

    // Spawn gate: at most one nidjo on screen. If ground isn't known yet
    // (e.g. before resize has fired) we just skip the spawn — the timer
    // rolls over to the next frame.
    const haveGround = Number.isFinite(groundY) && groundY > 0;
    if (this.instances.length === 0 && haveGround && this.timer >= this.nextSpawn) {
      this.timer = 0;
      this.scheduleNext();
      this.spawnOne(width, groundY);
    }

    // Step every instance, then drop any that have driven off either edge.
    for (const car of this.instances) {
      car.update(deltaTime);
    }
    this.despawnIfOffscreen(width);
  }

  /** Remove any instance whose full AABB has cleared the nearest edge.
 * Uses car.getBounds() (which already reflects scale and direction) so
 * the car despawns only after the entire vehicle has left the screen —
 * no more half-drawn chassis hanging off the edge. */
  despawnIfOffscreen(width) {
    this.instances = this.instances.filter((car) => {
      const b = car.getBounds();
      // Car fully cleared the left edge: its rightmost pixel passed x=0.
      const pastLeft = b.right < 0 && car.direction < 0;
      // Car fully cleared the right edge: its leftmost pixel passed width.
      const pastRight = b.left > width && car.direction > 0;
      return !(pastLeft || pastRight);
    });
  }

  /** Render every active instance via its own draw method. */
  draw(context) {
    for (const car of this.instances) {
      car.draw(context);
    }
  }

  /** Wipe all instances and reset timers — called on game restart. */
  reset() {
    this.instances = [];
    this.timer = 0;
    this.scheduleNext();
  }
}

/**
 * Sub-manager for the "toni" truck NPC — drives across the screen from one
 * edge to the other, then despawns. Slower and chunkier than Nidjo's car.
 *
 * Spawn gating: at most one toni on screen. Direction (+1/-1) is randomised
 * on every spawn; speed is randomised in [minSpeed, maxSpeed]. y is anchored
 * to groundY + 90 * scale so the truck rides above the ground line (the
 * offset is positive, unlike Nidjo's `groundY - 31 * scale`).
 */
export class NPCToniManager {
  constructor({
    minInterval = 10,
    maxInterval = 22,
    spawnMargin = 140,
    minSpeed = 90,
    maxSpeed = 150,
  } = {}) {
    this.minInterval = minInterval;
    this.maxInterval = maxInterval;
    this.spawnMargin = spawnMargin;
    this.minSpeed = minSpeed;
    this.maxSpeed = maxSpeed;

    this.instances = [];
    this.scheduleNext();
  }

  /** Roll a random duration until the next spawn attempt. */
  scheduleNext() {
    const span = Math.max(0, this.maxInterval - this.minInterval);
    this.nextSpawn = this.minInterval + Math.random() * span;
  }

  /**
   * Create one toni instance: randomised direction (left or right), random
   * forward speed in [minSpeed, maxSpeed], driving across the ground line.
   * Returns the new instance so callers (tests, debug overlays) can grab it.
   */
  spawnOne(width, groundY) {
    const scale = 0.70;
    // -1 or +1 with equal probability — alternating traffic both ways.
    const direction = Math.random() < 0.5 ? -1 : 1;
    const speed = this.minSpeed + Math.random() * (this.maxSpeed - this.minSpeed);
    // Spawn just off the appropriate edge with a small margin so the truck
    // doesn't pop into existence fully on-screen.
    const x = direction > 0
      ? -this.spawnMargin
      : width + this.spawnMargin;
    // Toni rides 90 * scale above the ground line (positive offset).
    const y = groundY + 90 * scale;

    const truck = new NPCToni(x, y, {
      scale,
      direction,
      velocityX: direction * speed,
      wheelSpeed: speed,
    });
    this.instances.push(truck);
    return truck;
  }

  /** Tick timers and walk every active instance forward by deltaTime. */
  update(deltaTime, width, height, groundY) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;

    this.timer = (this.timer || 0) + deltaTime;

    // Spawn gate: at most one toni on screen. If ground isn't known yet
    // (e.g. before resize has fired) we just skip the spawn — the timer
    // rolls over to the next frame.
    const haveGround = Number.isFinite(groundY) && groundY > 0;
    if (this.instances.length === 0 && haveGround && this.timer >= this.nextSpawn) {
      this.timer = 0;
      this.scheduleNext();
      this.spawnOne(width, groundY);
    }

    // Step every instance, then drop any that have driven off either edge.
    for (const truck of this.instances) {
      truck.update(deltaTime);
    }
    this.despawnIfOffscreen(width);
  }

  /** Remove any instance whose full AABB has cleared the nearest edge.
 * Uses truck.getBounds() (which already reflects scale and direction) so
 * the truck despawns only after the entire vehicle has left the screen —
 * no more half-drawn cab hanging off the edge. */
  despawnIfOffscreen(width) {
    this.instances = this.instances.filter((truck) => {
      const b = truck.getBounds();
      // Truck fully cleared the left edge: its rightmost pixel passed x=0.
      const pastLeft = b.right < 0 && truck.direction < 0;
      // Truck fully cleared the right edge: its leftmost pixel passed width.
      const pastRight = b.left > width && truck.direction > 0;
      return !(pastLeft || pastRight);
    });
  }

  /** Render every active instance via its own draw method. */
  draw(context) {
    for (const truck of this.instances) {
      truck.draw(context);
    }
  }

  /** Wipe all instances and reset timers — called on game restart. */
  reset() {
    this.instances = [];
    this.timer = 0;
    this.scheduleNext();
  }
}

/**
 * Sub-manager for the "konobari" friendly NPC. Spawns a sprite-sheet
 * character anywhere on the screen (uniform random y) and walks it
 * across the screen. On player overlap it grants +1 HP and is removed.
 *
 * Lifetime: at most one konobari on screen. Direction (+1/-1) is randomised
 * on every spawn; speed is randomised in [minSpeed, maxSpeed].
 *
 * Despawn uses getBounds() so the sprite vanishes only after its full AABB
 * has cleared the nearest edge (same standard as NPCNidjoManager /
 * NPCToniManager after their despawn-margin fix).
 *
 * `onPlayerHit` is the integration seam — wired by game.js to apply the
 * +1 HP and refresh the HUD, keeping this manager free of player/HUD
 * concerns.
 */
export class NPCKonobariManager {
  constructor({
    minInterval = 12,
    maxInterval = 22,
    spawnMargin = 120,
    minSpeed = 90,
    maxSpeed = 150,
    onPlayerHit = null,
  } = {}) {
    this.minInterval = minInterval;
    this.maxInterval = maxInterval;
    this.spawnMargin = spawnMargin;
    this.minSpeed = minSpeed;
    this.maxSpeed = maxSpeed;
    // Optional callback invoked the moment a player overlap is accepted.
    this.onPlayerHit = typeof onPlayerHit === "function" ? onPlayerHit : null;

    this.instances = [];
    this.scheduleNext();
  }

  /** Roll a random duration until the next spawn attempt. */
  scheduleNext() {
    const span = Math.max(0, this.maxInterval - this.minInterval);
    this.nextSpawn = this.minInterval + Math.random() * span;
  }

  /**
   * Create one konobari instance: randomised direction (left or right),
   * random forward speed, drawn anywhere across the canvas y-axis.
   * Returns the new instance so callers (tests, debug overlays) can grab it.
   */
  spawnOne(width, height) {
    const scale = 0.5;
    // -1 or +1 with equal probability — alternating traffic both ways.
    const direction = Math.random() < 0.5 ? -1 : 1;
    const speed = this.minSpeed + Math.random() * (this.maxSpeed - this.minSpeed);
    // Spawn just off the appropriate edge with a small margin so the
    // sprite doesn't pop into existence fully on-screen.
    const x = direction > 0
      ? -this.spawnMargin
      : width + this.spawnMargin;
    // Uniform random y anywhere on the canvas — the sprite's anchor sits
    // there directly (KonobariAnimation handles its own bobbing via the
    // sprite-sheet frames, so no extra y-offset is needed).
    const y = Math.random() * Math.max(1, height);

    const konobar = new NPCKonobari(x, y, {
      scale,
      direction,
      velocityX: direction * speed,
    });
    this.instances.push(konobar);
    return konobar;
  }

  /** Tick timers, walk every active instance, and resolve player overlaps. */
  update(deltaTime, width, height, player) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;

    this.timer = (this.timer || 0) + deltaTime;

    // Spawn gate: at most one konobari on screen.
    if (this.instances.length === 0 && this.timer >= this.nextSpawn) {
      this.timer = 0;
      this.scheduleNext();
      this.spawnOne(width, height);
    }

    // Step every instance, drop stragglers, then check player overlap.
    for (const konobar of this.instances) {
      konobar.update(deltaTime);
    }
    this.despawnIfOffscreen(width);
    this.checkPlayerOverlap(player);
  }

  /** Remove any instance whose full AABB has cleared the nearest edge. */
  despawnIfOffscreen(width) {
    this.instances = this.instances.filter((konobar) => {
      const b = konobar.getBounds();
      const pastLeft = b.right < 0 && konobar.direction < 0;
      const pastRight = b.left > width && konobar.direction > 0;
      return !(pastLeft || pastRight);
    });
  }

  /**
   * If the player AABB overlaps any active konobari, fire the
   * onPlayerHit callback and remove that instance (consumed on touch).
   * Player invincibility does not gate pickups — granting +1 HP is always
   * welcome — but we still guard against double-fires within a single
   * frame via the despawn-on-hit rule.
   */
  checkPlayerOverlap(player) {
    if (!player || typeof player.getBounds !== "function") return;
    const playerBounds = player.getBounds();
    if (!playerBounds) return;
    this.instances = this.instances.filter((konobar) => {
      const b = konobar.getBounds();
      const overlaps = !(
        b.right < playerBounds.left ||
        b.left > playerBounds.right ||
        b.bottom < playerBounds.top ||
        b.top > playerBounds.bottom
      );
      if (overlaps) {
        // Fire the callback once for the consumed instance; game.js wires
        // this to player.grantHealth(1) + HUD refresh.
        this.onPlayerHit?.(konobar.x, konobar.y);
        return false; // remove from instances
      }
      return true;
    });
  }

  /** Render every active instance via its own draw method. */
  draw(context) {
    for (const konobar of this.instances) {
      konobar.draw(context);
    }
  }

  /** Wipe all instances and reset timers — called on game restart. */
  reset() {
    this.instances = [];
    this.timer = 0;
    this.scheduleNext();
  }
}

/**
 * NPCManager — top-level facade for every NPC type in the game.
 *
 * Currently owns a single sub-manager (prsan). New sub-managers can be
 * registered by adding a property here and forwarding update/draw/reset
 * calls in the corresponding methods below. The contract for any new
 * sub-manager is the same three methods: update, draw, reset.
 */
export class NPCManager {
  constructor({ onPlayerHit = null } = {}) {
    this.Prsan = new NPCPrsanManager();
    this.Nidjo = new NPCNidjoManager();
    this.Toni = new NPCToniManager();
    // Konobari is the only sub-manager that needs the player reference
    // (for pickup overlap detection) and an onPlayerHit callback (to apply
    // +1 HP and refresh the HUD). game.js wires both via the parent's
    // constructor options.
    this.Konobari = new NPCKonobariManager({
      onPlayerHit: typeof onPlayerHit === "function" ? onPlayerHit : null,
    });
  }

  attachPlayer(player) {
    // Game.js calls this once after both manager and player exist; it just
    // gives Konobari the player it needs for overlap detection.
    this.Konobari.player = player;
  }

  update(deltaTime, width, height, groundY, player) {
    this.Prsan.update(deltaTime, width, height);
    this.Nidjo.update(deltaTime, width, height, groundY);
    this.Toni.update(deltaTime, width, height, groundY);
    this.Konobari.update(deltaTime, width, height, player);
  }

  draw(context) {
    this.Prsan.draw(context);
    this.Nidjo.draw(context);
    this.Toni.draw(context);
    this.Konobari.draw(context);
  }

  reset() {
    this.Prsan.reset();
    this.Nidjo.reset();
    this.Toni.reset();
    this.Konobari.reset();
  }
}