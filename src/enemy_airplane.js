const TAU = Math.PI * 2;
const HEAD_URL = new URL('../assets/images/cvrka.png', import.meta.url).href;
const INK = '#3d4547';
let sharedHead;

// The image is loaded once and reused by every airplane instance.
function loadHead() {
  if (!sharedHead) {
    sharedHead = new Promise((resolve, reject) => {
      const image = new Image();
      // PERF-FIX — explicit decode() so the bitmap is rasterised before
      // the first drawImage(). The airplane head is already preloaded via
      // AssetLoader (airplane-head key) which awaits decode() too, so by
      // the time this resolves the bitmap is already GPU-ready.
      image.onload = async () => {
        if (image.decode) {
          try { await image.decode(); } catch (_) { /* swallow */ }
        }
        resolve(image);
      };
      image.onerror = () => reject(new Error('Nije moguće učitati assets/images/prsan-head.png'));
      image.src = HEAD_URL;
    }).catch((error) => {
      sharedHead = null; // Allow a later instance to retry after a network failure.
      throw error;
    });
  }
  return sharedHead;
}

/** A code-drawn airplane with a transparent portrait, using the Player draw/update API. */
export class EnemyAirplane {
  constructor(x, y, { scale = 0.8, direction = 1, velocityX = 0 } = {}) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.direction = direction < 0 ? -1 : 1;
    this.velocityX = velocityX;
    this.rotation = 0;
    this.time = 0;
    this.propellerPhase = 0;
    this.throttle = 1;
    this.bobAmount = 3;
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
    this.propellerPhase = (this.propellerPhase + deltaTime * 32 * this.throttle) % TAU;
  }

  getPose() {
    return {
      y: this.y + Math.sin(this.time * 2.4) * this.bobAmount * this.scale,
      angle: this.rotation + Math.sin(this.time * 1.7) * 0.025,
    };
  }

  getBounds() {
    const pose = this.getPose();
    const cos = Math.cos(pose.angle);
    const sin = Math.sin(pose.angle);
    // Hitbox shrunk by 30% from the visible silhouette so the plane is
    // fairer to dodge — only a solid intersection with the fuselage counts.
    // The original sprite spans x ∈ [-71, 76], y ∈ [-99, 43]; we keep the
    // same proportions but shrink both axes by 0.7.
    const shrink = 0.7;
    const points = [[-71, -99], [76, -99], [76, 43], [-71, 43]].map(([x, y]) => {
      x *= this.scale * this.direction * shrink;
      y *= this.scale * shrink;
      return { x: this.x + x * cos - y * sin, y: pose.y + x * sin + y * cos };
    });
    return {
      left: Math.min(...points.map((p) => p.x)),
      right: Math.max(...points.map((p) => p.x)),
      top: Math.min(...points.map((p) => p.y)),
      bottom: Math.max(...points.map((p) => p.y)),
    };
  }

  draw(ctx) {
    const pose = this.getPose();
    ctx.save();
    ctx.translate(this.x, pose.y);
    ctx.rotate(pose.angle);
    ctx.scale(this.scale * this.direction, this.scale);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const shape = (color, path) => {
      ctx.beginPath();
      path();
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.stroke();
    };
    const oval = (x, y, rx, ry, color, angle = 0) => {
      shape(color, () => ctx.ellipse(x, y, rx, ry, angle, 0, TAU));
    };

   // Far wing, tail and landing gear are behind the fuselage.
shape('#E4DECC', () => {
  ctx.moveTo(7, 3); ctx.quadraticCurveTo(31, -36, 58, -30);
  ctx.quadraticCurveTo(67, -24, 38, 7);
});
shape('#B94F46', () => {
  ctx.moveTo(-71, 5); ctx.lineTo(-79, -41);
  ctx.quadraticCurveTo(-78, -54, -65, -45);
  ctx.quadraticCurveTo(-47, -31, -43, 3);
});
shape('#E4DECC', () => {
  ctx.moveTo(-76, -28); ctx.lineTo(-73, -15);
  ctx.lineTo(-52, -15); ctx.lineTo(-59, -28);
});
ctx.beginPath();
ctx.moveTo(23, 23); ctx.lineTo(23, 40);
ctx.moveTo(-47, 18); ctx.lineTo(-51, 30);
ctx.strokeStyle = '#3D4547';
ctx.lineWidth = 5; ctx.stroke(); ctx.lineWidth = 2.5;
oval(-51, 32, 7, 8, '#3D4547');
oval(23, 40, 11, 12, '#3D4547');
oval(23, 40, 4.5, 5, '#D6A057');

// Open cockpit and seat, then the body and portrait.
oval(-7, -4, 33, 20, '#3D4547');
oval(-24, -15, 13, 23, '#803B38', -.15);
shape('#DE7963', () => {
  ctx.moveTo(-29, -8); ctx.lineTo(-27, -31);
  ctx.quadraticCurveTo(-9, -45, 9, -29);
  ctx.lineTo(19, -6);
});
ctx.strokeStyle = '#3D4547'; ctx.lineWidth = 4;
ctx.beginPath(); ctx.moveTo(-22, -30); ctx.lineTo(-17, -10);
ctx.moveTo(3, -31); ctx.lineTo(7, -9); ctx.stroke();
ctx.strokeStyle = INK; ctx.lineWidth = 2.5;


// Main hull masks the lower body, making the portrait part of the cockpit.
shape('#B94F46', () => {
  ctx.moveTo(-78, 0);
  ctx.quadraticCurveTo(-53, -8, -35, -9);
  ctx.quadraticCurveTo(-9, 12, 22, -10);
  ctx.quadraticCurveTo(51, -24, 67, -10);
  ctx.quadraticCurveTo(85, 5, 62, 24);
  ctx.quadraticCurveTo(20, 43, -29, 22);
  ctx.quadraticCurveTo(-60, 17, -78, 0);
});
shape('#803B38', () => {
  ctx.moveTo(-48, 15); ctx.quadraticCurveTo(9, 32, 67, 12);
  ctx.quadraticCurveTo(55, 32, 17, 31);
  ctx.quadraticCurveTo(-21, 29, -48, 15);
});
oval(-65, 3, 25, 7, '#E4DECC', -.1);

// Forearm rests on the visible rim; simple shapes match the plane linework.
shape('#E5AD87', () => {
  ctx.moveTo(-24, -13); ctx.quadraticCurveTo(-20, -20, -14, -15);
  ctx.lineTo(-2, -11); ctx.quadraticCurveTo(5, -17, 10, -11);
  ctx.quadraticCurveTo(13, -5, 5, -3);
  ctx.quadraticCurveTo(-13, -3, -24, -8);
});
ctx.beginPath(); ctx.moveTo(3, -10); ctx.lineTo(4, -6); ctx.stroke();

// Small windscreen, motor cowling and the near wing.
shape('#BFD2CC', () => {
  ctx.moveTo(19, -11); ctx.quadraticCurveTo(23, -41, 33, -36);
  ctx.quadraticCurveTo(43, -32, 43, -15);
});
ctx.strokeStyle = '#E4DECC'; ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(29, -31);
ctx.quadraticCurveTo(35, -28, 36, -22);
ctx.stroke();
ctx.strokeStyle = INK; ctx.lineWidth = 2.5;

oval(66, 3, 15, 23, '#DE7963');
oval(72, 3, 9, 19, '#803B38');

shape('#E4DECC', () => {
  ctx.moveTo(11, 10); ctx.quadraticCurveTo(-11, 5, -44, 17);
  ctx.quadraticCurveTo(-60, 23, -36, 28);
  ctx.quadraticCurveTo(0, 34, 35, 17);
  ctx.quadraticCurveTo(39, 11, 11, 10);
});
ctx.strokeStyle = '#803B38'; ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(-33, 23);
ctx.quadraticCurveTo(-5, 26, 21, 17);
ctx.stroke();
ctx.strokeStyle = INK; ctx.lineWidth = 2.5;

if (this.head) {
  // Keep the original transparent image and its aspect ratio intact.
  // Its neck overlaps the shirt and is covered by the cockpit rim below.
  const headHeight = 95;
  const headWidth = headHeight * this.head.naturalWidth / this.head.naturalHeight;
  ctx.drawImage(this.head, -10 - headWidth / 2, -98, headWidth, headHeight);
}

// A projected spinning two-blade propeller; the shaft stays on the nose.
// Four fading past positions suggest speed without a flashing full disk.
for (let trail = 3; trail >= 0; trail -= 1) {
  const phase = this.propellerPhase - trail * 0.45;
  ctx.save();
  ctx.translate(87, 3);
  ctx.scale(0.22, 1);
  ctx.rotate(phase);
  ctx.globalAlpha *= trail === 0 ? .86 : .075;
  ctx.fillStyle = '#E4DECC';
  ctx.strokeStyle = '#3D4547';
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.ellipse(0, 0, 5, 33, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
oval(86, 3, 7, 7, '#D6A057');
ctx.restore();
  }
}

export default EnemyAirplane;
