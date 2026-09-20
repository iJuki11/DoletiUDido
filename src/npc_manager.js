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
 * NPCManager — top-level facade for every NPC type in the game.
 *
 * Currently owns a single sub-manager (prsan). New sub-managers can be
 * registered by adding a property here and forwarding update/draw/reset
 * calls in the corresponding methods below. The contract for any new
 * sub-manager is the same three methods: update, draw, reset.
 */
export class NPCManager {
  constructor() {
    this.Prsan = new NPCPrsanManager();
    this.Nidjo = new NPCNidjoManager();
    this.Toni = new NPCToniManager();
  }

  update(deltaTime, width, height, groundY) {
    this.Prsan.update(deltaTime, width, height);
    this.Nidjo.update(deltaTime, width, height, groundY);
    this.Toni.update(deltaTime, width, height, groundY);
  }

  draw(context) {
    this.Prsan.draw(context);
    this.Nidjo.draw(context);
    this.Toni.draw(context);
  }

  reset() {
    this.Prsan.reset();
    this.Nidjo.reset();
    this.Toni.reset();
  }
}