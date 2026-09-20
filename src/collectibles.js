const SIZE = 36;
// Collision radius is item.size × this factor. Exported so debug
// overlays (and any future feature that needs to know the same hitbox)
// stay in lockstep with the collision test in CollectibleManager.collect().
export const COLLECTIBLE_RADIUS_FACTOR = 0.28;
export class CollectibleManager {
  // onCollect was removed — game.js reads the return value of collect() and
  // mutates game state itself, so the callback was unused. Add it back if a
  // future feature needs to react to collection outside the game loop.
  constructor() { this.items = []; this.spawnTimer = 0; this.nextSpawn = .8; this.coffeeTimer = 0; this.nextCoffee = 3 + Math.random() * 2; }
  reset() { this.items = []; this.spawnTimer = 0; this.coffeeTimer = 0; this.nextSpawn = .75; this.nextCoffee = 3 + Math.random() * 2; }
  update(dt, speed, width, height, groundY) {
    this.spawnTimer += dt; this.coffeeTimer += dt;
    const spawn = (type) => { const top = Math.max(120, height * .17); const bottom = Math.max(top + 80, groundY - 70); this.items.push({ type, x: width + SIZE, y: top + Math.random() * (bottom - top), size: SIZE, phase: Math.random() * Math.PI * 2, collected: false }); };
    if (this.spawnTimer >= this.nextSpawn) { this.spawnTimer = 0; this.nextSpawn = 1.25 + Math.random() * .85; spawn("beer"); }
    if (this.coffeeTimer >= this.nextCoffee) { this.coffeeTimer = 0; this.nextCoffee = 3 + Math.random() * 2; spawn("coffee"); }
    for (const item of this.items) { item.x -= speed * dt; item.phase += dt * 4; }
    this.items = this.items.filter((item) => item.x > -SIZE && !item.collected);
  }
  collect(bounds) { const out = []; for (const item of this.items) { const r = item.size * COLLECTIBLE_RADIUS_FACTOR; const x = Math.max(bounds.left, Math.min(item.x, bounds.right)); const y = Math.max(bounds.top, Math.min(item.y, bounds.bottom)); if ((item.x-x)**2 + (item.y-y)**2 < r*r) { item.collected = true; out.push(item); } } return out; }
  draw(ctx) { for (const item of this.items) { const bob = Math.sin(item.phase) * 4; const scale = 1 + Math.sin(item.phase * .7) * .035; if (item.type === "coffee") drawCoffee(ctx, item.x, item.y + bob, scale); else drawBeer(ctx, item.x, item.y + bob, scale); } }
}

//80502f
function drawBeer(c,x,y,s){c.save();c.translate(x,y);c.scale(s,s);c.shadowColor="rgba(245,184,46,.55)";c.shadowBlur=18;c.fillStyle="#f5b82e";c.strokeStyle="#fff6ec";c.lineWidth=3;c.beginPath();c.roundRect(-13,-15,23,31,5);c.fill();c.stroke();c.shadowBlur=0;c.beginPath();c.roundRect(9,-9,11,18,5);c.stroke();c.fillStyle="#fff4cb";c.beginPath();c.roundRect(-14,-17,25,8,4);c.fill();c.restore();}
function drawCoffee(c,x,y,s){c.save();c.translate(x,y);c.scale(s,s);c.strokeStyle="#fff6ec";c.lineWidth=3;c.beginPath();c.moveTo(-7,-18);c.quadraticCurveTo(-12,-25,-6,-29);c.moveTo(3,-18);c.quadraticCurveTo(8,-25,3,-29);c.stroke();c.shadowColor="rgba(245,184,46,.55)";c.shadowBlur=18;c.fillStyle="#fff6ec";c.strokeStyle="#fff6ec";c.lineWidth=3;c.beginPath();c.roundRect(-14,-10,25,20,4);c.fill();c.stroke();c.beginPath();c.arc(14,0,7,-Math.PI/2,Math.PI/2);c.stroke();c.shadowBlur=0;c.restore();}
