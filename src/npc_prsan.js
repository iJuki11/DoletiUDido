const TAU = Math.PI * 2;
const HEAD_URL = new URL('../assets/images/prsan_head.png', import.meta.url).href;
const INK = '#3d4547';
let headPromise;

function loadHead() {
  if (!headPromise) {
    headPromise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Nije moguće učitati prsan-head-semi-realistic.png'));
      image.src = HEAD_URL;
    }).catch((error) => {
      headPromise = null;
      throw error;
    });
  }
  return headPromise;
}

/** x/y is the pilot's neck position. Speeds are world pixels per second. */
export class NPCPrsan {
  constructor(x, y, { scale = 0.6, fallSpeed = 24, velocityX = 0 } = {}) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.fallSpeed = fallSpeed;
    this.velocityX = velocityX;
    this.rotation = 0;
    this.time = 0;
    this.wind = 0;
    this.gust = 0;
    this.head = null;
    this.loadError = null;
    this.ready = loadHead().then((image) => {
      this.head = image;
      return true;
    }, (error) => {
      this.loadError = error;
      return false;
    });
  }

  update(deltaTime) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
    this.time += deltaTime;
    this.x += this.velocityX * deltaTime;
    this.y += this.fallSpeed * deltaTime;
    this.gust *= Math.exp(-deltaTime * 1.5);
  }

  // A brief gust increases the swing and then smoothly decays.
  puff(strength = 1) {
    this.gust = Math.max(-1.5, Math.min(1.5, strength));
  }

  getPose() {
    const swing = Math.sin(this.time * 1.65);
    const wind = Math.max(-1, Math.min(1, this.wind)) + this.gust;
    return {
      x: this.x + (swing * 6 + wind * 7) * this.scale,
      y: this.y + Math.sin(this.time * 2.1) * 1.4 * this.scale,
      angle: this.rotation + Math.sin(this.time * 1.1) * 0.025 + wind * 0.035,
      pilotX: swing * 8 + wind * 5,
      pilotY: Math.cos(this.time * 1.65) * 1.5,
      pilotAngle: -swing * 0.055 - wind * 0.035,
      breath: Math.sin(this.time * 2.1) * 1.3,
    };
  }

  // Body-only AABB for collisions; canopy and thin ropes are decorative.
  getBounds() {
    const p = this.getPose();
    const corners = [[-31, -65], [31, -65], [31, 93], [-31, 93]];
    const points = corners.map(([x, y]) => {
      const px = p.pilotX + x * Math.cos(p.pilotAngle) - y * Math.sin(p.pilotAngle);
      const py = p.pilotY + x * Math.sin(p.pilotAngle) + y * Math.cos(p.pilotAngle);
      return {
        x: p.x + this.scale * (px * Math.cos(p.angle) - py * Math.sin(p.angle)),
        y: p.y + this.scale * (px * Math.sin(p.angle) + py * Math.cos(p.angle)),
      };
    });
    return {
      left: Math.min(...points.map((p) => p.x)), right: Math.max(...points.map((p) => p.x)),
      top: Math.min(...points.map((p) => p.y)), bottom: Math.max(...points.map((p) => p.y)),
    };
  }

  draw(ctx) {
    const p = this.getPose();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.scale(this.scale, this.scale);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const shape = (color, path, stroke = true) => {
      ctx.beginPath(); path(); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      if (stroke) ctx.stroke();
    };
    const oval = (x, y, rx, ry, color) => shape(color, () => ctx.ellipse(x, y, rx, ry, 0, 0, TAU));
    const pilotPoint = (x, y) => ({
      x: p.pilotX + x * Math.cos(p.pilotAngle) - y * Math.sin(p.pilotAngle),
      y: p.pilotY + x * Math.sin(p.pilotAngle) + y * Math.cos(p.pilotAngle),
    });

    // Every rope uses the same transformed attachment as the pilot's hand.
    ctx.strokeStyle = '#697d72';
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      const hand = pilotPoint(side * 38, -2);
      for (const anchor of [32, 64, 96]) {
        ctx.beginPath();
        ctx.moveTo(side * anchor, -106);
        ctx.lineTo(hand.x, hand.y);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 2.3;

    // A round, scalloped canopy with broad alternating fabric panels.
    const top = -178 - p.breath;
    const canopy = () => {
      ctx.moveTo(-96, -106);
      ctx.bezierCurveTo(-91, top + 22, -49, top, 0, top);
      ctx.bezierCurveTo(49, top, 91, top + 22, 96, -106);
      for (let x = 96; x > -96; x -= 32) ctx.quadraticCurveTo(x - 16, -118, x - 32, -106);
    };
    shape('#799b8c', canopy);
    ctx.save();
    ctx.beginPath(); canopy(); ctx.closePath(); ctx.clip();
    shape('#e4decc', () => {
      ctx.moveTo(0, top); ctx.bezierCurveTo(-28, top + 14, -36, -139, -32, -101);
      ctx.lineTo(-64, -101); ctx.bezierCurveTo(-70, -143, -44, top + 3, 0, top);
    }, false);
    shape('#e4decc', () => {
      ctx.moveTo(0, top); ctx.bezierCurveTo(44, top + 3, 70, -143, 64, -101);
      ctx.lineTo(32, -101); ctx.bezierCurveTo(36, -139, 28, top + 14, 0, top);
    }, false);
    ctx.fillStyle = '#536e62'; ctx.globalAlpha *= .16;
    ctx.fillRect(-100, -121, 200, 22);
    ctx.restore();
    ctx.strokeStyle = '#536e62'; ctx.lineWidth = 1.3;
    for (const end of [-64, -32, 0, 32, 64]) {
      ctx.beginPath(); ctx.moveTo(0, top + 1);
      ctx.quadraticCurveTo(end * 1.1, top + 19, end, -106); ctx.stroke();
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 2.3;
    ctx.beginPath(); canopy(); ctx.closePath(); ctx.stroke();
    oval(0, top + 1, 5, 2.2, '#d6a057');

    ctx.save();
    ctx.translate(p.pilotX, p.pilotY);
    ctx.rotate(p.pilotAngle);

    // Backpack, relaxed dangling legs and chunky shoes.
    shape('#d1b989', () => {
      ctx.moveTo(-23, 11); ctx.quadraticCurveTo(-36, 20, -29, 43);
      ctx.lineTo(29, 43); ctx.quadraticCurveTo(35, 20, 23, 11);
    });
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 12, 43);
      ctx.rotate(side * .1 + Math.sin(this.time * 1.9 + side * .8) * .1);
      shape('#77817a', () => {
        ctx.moveTo(-9, -3); ctx.lineTo(10, -3);
        ctx.lineTo(8, 31); ctx.quadraticCurveTo(0, 37, -8, 30);
      });
      shape('#414e49', () => {
        ctx.moveTo(-8, 28); ctx.lineTo(7, 28);
        ctx.quadraticCurveTo(10, 35, 16, 37);
        ctx.quadraticCurveTo(20, 45, 10, 46);
        ctx.lineTo(-8, 44); ctx.quadraticCurveTo(-12, 39, -8, 28);
      });
      ctx.strokeStyle = '#e4decc'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-7, 40); ctx.lineTo(13, 42); ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 2.3;
      ctx.restore();
    }

    // Arms reach the rope bundles; fists stay anchored as the body swings.
    for (const side of [-1, 1]) {
      shape('#dda782', () => {
        ctx.moveTo(side * 20, 13); ctx.lineTo(side * 31, 14);
        ctx.quadraticCurveTo(side * 43, 8, side * 43, -3);
        ctx.quadraticCurveTo(side * 40, -10, side * 34, -4);
        ctx.lineTo(side * 29, 3); ctx.lineTo(side * 19, 4);
      });
      oval(side * 38, -3, 5.5, 6.5, '#e9b28c');
      ctx.beginPath(); ctx.moveTo(side * 35, -3); ctx.lineTo(side * 40, -1); ctx.stroke();
    }
    shape('#557e78', () => {
      ctx.moveTo(-12, 0); ctx.quadraticCurveTo(-23, 0, -28, 8);
      ctx.lineTo(-22, 19); ctx.lineTo(-23, 43);
      ctx.quadraticCurveTo(0, 51, 23, 43);
      ctx.lineTo(22, 19); ctx.lineTo(28, 8);
      ctx.quadraticCurveTo(23, 0, 12, 0);
    });
    // Two flat shirt accents echo the existing teal palette.
    shape('#71998c', () => { ctx.moveTo(-18, 16); ctx.lineTo(-5, 11); ctx.lineTo(-10, 30); ctx.lineTo(-19, 34); }, false);
    shape('#71998c', () => { ctx.moveTo(1, 22); ctx.lineTo(19, 14); ctx.lineTo(12, 33); ctx.lineTo(1, 38); }, false);
    ctx.strokeStyle = '#374b46'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-17, 4); ctx.lineTo(-11, 43);
    ctx.moveTo(17, 4); ctx.lineTo(11, 43);
    ctx.moveTo(-21, 38); ctx.lineTo(21, 38); ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
    shape('#d6a057', () => ctx.rect(-5, 34, 10, 8));
    ctx.lineWidth = 2.3;

    if (this.head) {
      const height = 74;
      const width = height * this.head.naturalWidth / this.head.naturalHeight;
      ctx.drawImage(this.head, -width / 2, -67, width, height);
    }
    ctx.restore();
    ctx.restore();
  }
}

export default NPCPrsan;
