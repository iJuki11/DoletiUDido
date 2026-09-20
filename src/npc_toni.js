const TAU = Math.PI * 2;
const HEAD_URL = new URL('../assets/images/toni_head.png', import.meta.url).href;
const INK = '#3d4547';
const WHEEL_RADIUS = 34;
const C = {
  cream: '#E4DECC', light: '#F1EBD9', shade: '#C7BFA9',
  red: '#B94F46', redLight: '#DE7963', redDark: '#803B38',
  blue: '#466A81', glass: '#BFD2CC', dark: '#30383A',
  gold: '#D6A057', skin: '#E5AD87', skinShade: '#C88869',
};
const headImages = new Map();

// Shared across instances; a failed load can be retried by the next instance.
function loadHead(url) {
  if (!headImages.has(url)) {
    headImages.set(url, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Nije moguće učitati PNG glavu: ${url}`));
      image.src = url;
    }).catch((error) => {
      headImages.delete(url);
      throw error;
    }));
  }
  return headImages.get(url);
}

/**
 * Toni — Canvas 2D tractor unit in strict side view.
 * Same public update/draw/getBounds API as NPCPrsan / NPCNidjo.
 * x/y = centre of the chassis / wheel-axle height. Ground = y + 34 * scale.
 * direction: +1 faces right, -1 faces left. deltaTime is in seconds.
 * Only the portrait (toni_head.png) is a PNG; all other artwork is drawn here.
 *
 * Renamed from `EnemyTruck` to fit the NPC family naming (NPCPrsan,
 * NPCNidjo, NPCToni, ...) used by NPCManager sub-managers.
 */
export class NPCToni {
  constructor(x, y, {
    scale = 0.8, direction = 1, velocityX = 0,
    wheelSpeed = null, headUrl = HEAD_URL,
  } = {}) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.direction = direction < 0 ? -1 : 1;
    this.velocityX = velocityX;
    // null follows velocityX. Set a local forward speed for an in-place preview.
    this.wheelSpeed = wheelSpeed;
    this.rotation = 0;
    this.time = 0;
    this.wheelPhase = 0;
    this.bobAmount = 1.15;
    this.headHeight = 126;
    this.head = null;
    this.loadError = null;
    this.ready = loadHead(headUrl).then((image) => {
      this.head = image;
      return true;
    }, (error) => {
      this.loadError = error;
      return false;
    });
  }

  get rollingSpeed() {
    return this.wheelSpeed ?? this.velocityX * this.direction;
  }

  update(deltaTime) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
    this.time += deltaTime;
    this.x += this.velocityX * deltaTime;
    const radius = WHEEL_RADIUS * Math.max(Math.abs(this.scale), 0.001);
    this.wheelPhase = (this.wheelPhase + this.rollingSpeed * deltaTime / radius) % TAU;
  }

  getPose() {
    const motion = Math.min(Math.abs(this.rollingSpeed) / 60, 1);
    return {
      y: this.y,
      angle: this.rotation,
      // Suspension moves the cab, keeping the tyres on the road.
      cabinBounce: Math.sin(this.time * 11) * this.bobAmount * (0.15 + 0.85 * motion),
      headLean: -0.085 + Math.sin(this.time * 2.2) * 0.012,
    };
  }

  getBounds() {
    // Solid truck hitbox; the antenna and projecting mirror do not collide.
    const pose = this.getPose();
    const cosine = Math.cos(pose.angle);
    const sine = Math.sin(pose.angle);
    const top = Math.min(-212, -212 + pose.cabinBounce);
    const points = [[-160, top], [158, top], [158, 34], [-160, 34]].map(([x, y]) => {
      x *= this.scale * this.direction;
      y *= this.scale;
      return { x: this.x + x * cosine - y * sine, y: pose.y + x * sine + y * cosine };
    });
    return {
      left: Math.min(...points.map(p => p.x)),
      right: Math.max(...points.map(p => p.x)),
      top: Math.min(...points.map(p => p.y)),
      bottom: Math.max(...points.map(p => p.y)),
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

    const shape = (color, path, outlined = true) => {
      ctx.beginPath(); path(); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      if (outlined) ctx.stroke();
    };
    const oval = (x, y, rx, ry, color) => shape(color, () => ctx.ellipse(x, y, rx, ry, 0, 0, TAU));
    const box = (x, y, w, h, r, color, outlined = true) =>
      shape(color, () => ctx.roundRect(x, y, w, h, r), outlined);
    const line = (color, width, path) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); path(); ctx.stroke(); ctx.restore();
    };

    // Chassis, fifth-wheel coupling and rear mudflap.
    box(-169, -25, 316, 26, 4, C.redDark);
    box(-157, -36, 162, 12, 3, C.red);
    box(-134, -46, 54, 10, 4, INK);
    box(-144, -51, 74, 7, 3, C.dark);
    box(-164, -11, 13, 40, 2, INK);
    box(-171, -18, 10, 15, 3, C.red);
    box(-169, -16, 6, 6, 2, C.gold, false);

    const wheel = (x) => {
      oval(x, 0, 34, 34, C.dark);
      oval(x, 0, 28.5, 28.5, INK);
      oval(x, 0, 22.5, 22.5, C.cream);
      oval(x, 0, 19, 19, C.red);
      ctx.save();
      ctx.translate(x, 0);
      ctx.rotate(this.wheelPhase);
      // Rotating rim vents and bolts make the motion legible without flashing.
      for (let i = 0; i < 8; i += 1) {
        const a = i * TAU / 8;
        ctx.save(); ctx.rotate(a);
        shape(C.redDark, () => ctx.ellipse(0, -14, 2.5, 3.5, 0, 0, TAU), false);
        shape(C.cream, () => ctx.ellipse(0, -8, 1.4, 1.4, 0, 0, TAU), false);
        ctx.restore();
      }
      line(C.shade, 1.4, () => { ctx.moveTo(24, -3); ctx.lineTo(26, -3); });
      ctx.restore();
      oval(x, 0, 5.5, 5.5, C.redDark);
    };
    wheel(-112);
    wheel(100);

    ctx.save();
    ctx.translate(0, pose.cabinBounce * 0.35);
    // A slim rear mudguard follows the wheel, leaving the hub visible.
    shape(C.red, () => {
      ctx.moveTo(-153, 0);
      ctx.lineTo(-153, -17);
      ctx.bezierCurveTo(-153, -47, -73, -47, -71, -16);
      ctx.lineTo(-71, 0); ctx.lineTo(-78, 0);
      ctx.bezierCurveTo(-78, -44, -146, -44, -146, 0);
    });
    line(C.redLight, 2, () => {
      ctx.moveTo(-147, -24); ctx.quadraticCurveTo(-112, -46, -80, -24);
    });
    // Red side skirt / fuel tank, with the reference's amber side markers.
    box(-69, -32, 103, 52, 5, C.red);
    box(-64, 9, 93, 8, 2, C.redDark, false);
    line(C.redDark, 2, () => { ctx.moveTo(-52, -28); ctx.lineTo(-52, 7); });
    oval(-57, -20, 4, 4, C.gold);
    oval(20, -20, 4, 4, C.gold);
    box(-65, -39, 58, 7, 2, C.shade);
    line(INK, 1.2, () => {
      for (let x = -57; x < -10; x += 10) { ctx.moveTo(x, -37); ctx.lineTo(x + 3, -34); }
    });
    ctx.restore();

    ctx.save();
    ctx.translate(0, pose.cabinBounce);

    // High sleeper cab and rounded roof fairing, all in one side projection.
    shape(C.cream, () => {
      ctx.moveTo(-7, 15); ctx.lineTo(-9, -184);
      ctx.quadraticCurveTo(-9, -201, 8, -209);
      ctx.quadraticCurveTo(47, -227, 124, -216);
      ctx.quadraticCurveTo(145, -214, 148, -194);
      ctx.lineTo(159, -55); ctx.lineTo(159, 15);
      ctx.lineTo(141, 15);
      ctx.bezierCurveTo(150, -49, 49, -49, 58, 15);
      ctx.closePath();
    });
    shape(C.shade, () => {
      ctx.moveTo(-7, -180); ctx.lineTo(6, -185);
      ctx.lineTo(6, -42); ctx.lineTo(-7, -35);
    }, false);
    shape(C.light, () => {
      ctx.moveTo(4, -207); ctx.quadraticCurveTo(48, -222, 123, -212);
      ctx.lineTo(131, -205); ctx.quadraticCurveTo(56, -214, 5, -198);
    }, false);
    line(INK, 2, () => {
      ctx.moveTo(-8, -182); ctx.quadraticCurveTo(67, -200, 149, -188);
    });
    // Roof lights and aerial.
    line(INK, 1.7, () => { ctx.moveTo(15, -214); ctx.lineTo(9, -245); });
    box(9, -216, 12, 5, 2, INK);
    box(91, -224, 13, 7, 3, C.gold);
    box(132, -216, 12, 8, 3, C.gold);

    // Small red roof graphic from the reference, simplified into flat bands.
    shape(C.red, () => {
      ctx.moveTo(16, -192); ctx.lineTo(59, -191); ctx.lineTo(47, -187);
      ctx.lineTo(26, -187); ctx.lineTo(38, -179); ctx.lineTo(15, -184);
    }, false);
    line(C.red, 2, () => { ctx.moveTo(35, -178); ctx.lineTo(57, -173); });

    // The window is an open dark hole. A narrow windscreen edge remains at the nose.
    shape(INK, () => {
      ctx.moveTo(72, -174); ctx.quadraticCurveTo(100, -181, 136, -174);
      ctx.lineTo(142, -117); ctx.quadraticCurveTo(142, -109, 134, -108);
      ctx.lineTo(70, -108); ctx.lineTo(69, -161);
      ctx.quadraticCurveTo(68, -171, 72, -174);
    });
    shape(C.glass, () => {
      ctx.moveTo(136, -174); ctx.lineTo(143, -171);
      ctx.lineTo(149, -119); ctx.lineTo(142, -116);
    });
    line(C.light, 1.6, () => { ctx.moveTo(140, -164); ctx.lineTo(143, -137); });
    shape(C.redDark, () => {
      ctx.moveTo(74, -113); ctx.lineTo(73, -141);
      ctx.quadraticCurveTo(75, -155, 85, -148); ctx.lineTo(100, -110);
    });

    // Driver's shoulder lives inside the opening, then the PNG leans out.
    shape(C.blue, () => {
      ctx.moveTo(72, -111); ctx.lineTo(77, -127);
      ctx.quadraticCurveTo(89, -137, 108, -121);
      ctx.lineTo(114, -105); ctx.lineTo(84, -99);
    });
    if (this.head) {
      const h = this.headHeight;
      const w = h * this.head.naturalWidth / this.head.naturalHeight;
      ctx.save();
      ctx.translate(103, -111);
      ctx.rotate(pose.headLean);
      // The supplied face looks left. Mirror only the portrait in a right-facing truck.
      ctx.scale(-1, 1);
      ctx.drawImage(this.head, -w / 2, -h + 4, w, h);
      ctx.restore();
    }

    // Sill / outer door mask the lower neck. Forearm is drawn OVER this edge.
    shape(C.cream, () => {
      ctx.moveTo(68, -108); ctx.lineTo(144, -108);
      ctx.lineTo(146, -79); ctx.lineTo(69, -79);
    }, false);
    box(69, -111, 76, 6, 2, C.shade);

    // Red-white-blue step stripes continue across the flat side of the cab.
    shape(C.red, () => {
      ctx.moveTo(-7, -149); ctx.lineTo(6, -149); ctx.lineTo(6, -89);
      ctx.lineTo(157, -89); ctx.lineTo(157, -81); ctx.lineTo(-3, -81);
      ctx.lineTo(-3, -141); ctx.lineTo(-7, -141);
    }, false);
    shape(C.blue, () => {
      ctx.moveTo(-7, -137); ctx.lineTo(-7, -69); ctx.lineTo(158, -69);
      ctx.lineTo(158, -77); ctx.lineTo(2, -77); ctx.lineTo(2, -137);
    }, false);

    // Door seam, handle, sleeper vent and a small crest in the reference colours.
    line(INK, 1.5, () => {
      ctx.moveTo(64, -180); ctx.lineTo(63, -51);
      ctx.quadraticCurveTo(66, -43, 75, -44); ctx.lineTo(125, -44);
    });
    box(73, -65, 17, 6, 2, C.shade);
    line(INK, 1.5, () => { ctx.moveTo(77, -62); ctx.lineTo(86, -62); });
    box(22, -61, 27, 17, 3, C.shade);
    line(INK, 1.3, () => {
      for (let y = -56; y <= -49; y += 3.5) { ctx.moveTo(27, y); ctx.lineTo(44, y); }
    });
    shape(C.blue, () => {
      ctx.moveTo(27, -157); ctx.lineTo(46, -157); ctx.lineTo(46, -143);
      ctx.quadraticCurveTo(37, -132, 27, -143);
    });
    box(34, -153, 5, 13, 1, C.red, false);

    // Sleeve, upper arm and broad bent forearm outside the door.
    shape(C.blue, () => {
      ctx.moveTo(74, -120); ctx.quadraticCurveTo(84, -128, 93, -115);
      ctx.lineTo(99, -104); ctx.lineTo(84, -97); ctx.lineTo(74, -105);
    });
    shape(C.skin, () => {
      ctx.moveTo(88, -108); ctx.lineTo(98, -110);
      ctx.quadraticCurveTo(102, -102, 107, -101);
      ctx.lineTo(126, -102); ctx.quadraticCurveTo(137, -105, 140, -96);
      ctx.quadraticCurveTo(143, -89, 133, -88);
      ctx.lineTo(107, -87); ctx.quadraticCurveTo(88, -88, 84, -99);
      ctx.closePath();
    });
    shape(C.skinShade, () => {
      ctx.moveTo(86, -99); ctx.quadraticCurveTo(95, -92, 109, -92);
      ctx.lineTo(138, -93); ctx.quadraticCurveTo(136, -87, 126, -88);
      ctx.lineTo(108, -88); ctx.quadraticCurveTo(90, -88, 86, -99);
    }, false);
    line(INK, 1.35, () => {
      ctx.moveTo(131, -99); ctx.lineTo(133, -93);
      ctx.moveTo(135, -99); ctx.lineTo(136, -94);
    });

    // Mirror outside the leading edge; positioned away from the driver's face.
    line(INK, 3, () => {
      ctx.moveTo(146, -160); ctx.lineTo(168, -156); ctx.lineTo(170, -132);
      ctx.moveTo(145, -120); ctx.lineTo(168, -120);
    });
    box(163, -159, 15, 41, 5, C.cream);
    box(171, -155, 5, 32, 2, C.shade, false);

    // Front wheel arch; the tyre remains a perfect side-on circle.
    shape(C.shade, () => {
      ctx.moveTo(50, 16);
      ctx.bezierCurveTo(40, -57, 161, -57, 150, 16);
      ctx.lineTo(141, 16);
      ctx.bezierCurveTo(151, -42, 49, -42, 59, 16);
    });
    line(C.light, 3, () => {
      ctx.moveTo(51, -13); ctx.bezierCurveTo(62, -49, 131, -49, 145, -13);
    });
    // Two entry steps behind the front wheel.
    box(8, -31, 39, 13, 2, C.cream);
    box(3, -12, 39, 15, 2, C.cream);
    box(12, -27, 30, 5, 1, INK, false);
    box(7, -8, 30, 5, 1, INK, false);
    // Front corner, bumper, headlight edge and marker.
    box(148, -27, 16, 32, 3, C.cream);
    box(151, -24, 12, 12, 2, C.gold);
    box(153, -22, 6, 5, 1, C.light, false);
    box(148, 6, 22, 17, 4, C.red);
    box(154, 10, 12, 5, 2, C.redLight, false);
    oval(144, 19, 4, 4, C.gold);

    // Tiny side badge. Counter-mirror text so it is readable in either direction.
    ctx.save();
    ctx.translate(119, -57);
    ctx.scale(this.direction, 1);
    ctx.fillStyle = INK; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('FH12', 0, 0);
    ctx.restore();
    ctx.restore();
    ctx.restore();
  }
}

export default NPCToni;
