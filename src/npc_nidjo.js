const TAU = Math.PI * 2;
const HEAD_URL = new URL('../assets/images/nidjo_head.png', import.meta.url).href;
const INK = '#3d4547';
const WHEEL_RADIUS = 31;
const C = {
  body: '#797C76', light: '#989C91', shade: '#62675F',
  deep: '#515A55', glass: '#BFD2CC', rearGlass: '#9AAFA7',
  tyre: '#30383A', rim: '#D2D0BE', rimShade: '#A8AD9F',
  cream: '#E4DECC', red: '#B94F46', redLight: '#DE7963',
  amber: '#D6A057', shirt: '#60829C', shirtDark: '#466A81',
  skin: '#E5AD87', skinLight: '#F0BF99', skinShade: '#C88869',
};
const headImages = new Map();

function loadHead(url) {
  if (!headImages.has(url)) {
    headImages.set(url, new Promise((resolve, reject) => {
      const image = new Image();
      // PERF-FIX — explicit decode() so the bitmap is rasterised before
      // the first drawImage(). Combined with the AssetLoader prewarm
      // (nidjo-head key) the first NPC spawn no longer stalls.
      image.onload = async () => {
        if (image.decode) {
          try { await image.decode(); } catch (_) { /* swallow */ }
        }
        resolve(image);
      };
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
 * Nidjo — grey estate car in strict side view; Canvas artwork plus one PNG
 * portrait (nidjo_head.png). Same public update/draw/getBounds API as
 * NPCPrsan. x/y = chassis origin / axle height. Ground = y + 31 * scale.
 * direction: +1 right, -1 left. deltaTime: seconds. velocityX: pixels/second.
 *
 * Renamed from `Nidjo` so it matches the NPC family convention (NPCPrsan,
 * NPCNidjo, ...) used by NPCManager sub-managers.
 */
export class NPCNidjo {
  constructor(x, y, {
    scale = 0.8, direction = 1, velocityX = 0,
    wheelSpeed = null, headUrl = HEAD_URL,
  } = {}) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.direction = direction < 0 ? -1 : 1;
    this.velocityX = velocityX;
    // Optional local forward speed, for an in-place preview or scrolling road.
    this.wheelSpeed = wheelSpeed;
    this.rotation = 0;
    this.time = 0;
    this.wheelPhase = 0;
    this.bobAmount = 0.85;
    this.headHeight = 87;
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
    const movement = Math.min(Math.abs(this.rollingSpeed) / 60, 1);
    return {
      y: this.y,
      angle: this.rotation,
      bodyBounce: Math.sin(this.time * 11) * this.bobAmount * (0.1 + 0.9 * movement),
      headLean: -0.065 + Math.sin(this.time * 2.2) * 0.012,
    };
  }

  getBounds() {
    // Simple solid-car AABB; antenna, mirror and protruding head are excluded.
    const pose = this.getPose();
    const cosine = Math.cos(pose.angle);
    const sine = Math.sin(pose.angle);
    const top = Math.min(-121, -121 + pose.bodyBounce);
    const points = [[-201, top], [209, top], [209, 31], [-201, 31]].map(([x, y]) => {
      x *= this.scale * this.direction;
      y *= this.scale;
      return {x: this.x + x * cosine - y * sine, y: pose.y + x * sine + y * cosine};
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

    const shape = (color, path, outline = true) => {
      ctx.beginPath(); path(); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      if (outline) ctx.stroke();
    };
    const oval = (x, y, rx, ry, color, outline = true) =>
      shape(color, () => ctx.ellipse(x, y, rx, ry, 0, 0, TAU), outline);
    const box = (x, y, w, h, r, color, outline = true) =>
      shape(color, () => ctx.roundRect(x, y, w, h, r), outline);
    const line = (color, width, path) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); path(); ctx.stroke(); ctx.restore();
    };

    // Undercarriage and tyres. Only the body bounces; the contact patches stay put.
    box(-192, -12, 386, 22, 6, C.tyre);
    const wheel = (x) => {
      oval(x, 0, 31, 31, C.tyre);
      oval(x, 0, 26, 26, INK);
      oval(x, 0, 21, 21, C.rim);
      oval(x, 0, 17.5, 17.5, C.deep);
      ctx.save(); ctx.translate(x, 0); ctx.rotate(this.wheelPhase);
      // Five pairs of alloy spokes, simplified from the reference wheels.
      for (let i = 0; i < 5; i += 1) {
        ctx.save(); ctx.rotate(i * TAU / 5);
        shape(C.rim, () => {
          ctx.moveTo(-3, -3); ctx.lineTo(-6, -16);
          ctx.lineTo(-3, -18); ctx.lineTo(0, -7);
          ctx.lineTo(3, -18); ctx.lineTo(6, -16); ctx.lineTo(3, -3);
        }, false);
        ctx.restore();
      }
      oval(0, 0, 6, 6, C.rimShade);
      for (let i = 0; i < 5; i += 1) {
        const a = i * TAU / 5;
        oval(Math.sin(a) * 4, Math.cos(a) * 4, 0.8, 0.8, INK, false);
      }
      oval(0, 0, 2.2, 2.2, C.rim, false);
      ctx.restore();
    };
    wheel(-130);
    wheel(128);

    ctx.save(); ctx.translate(0, pose.bodyBounce);

    // Long estate roof, upright tailgate and sloping bonnet, all in side elevation.
    const bodyPath = () => {
      ctx.moveTo(-204, 12); ctx.lineTo(-204, -72);
      ctx.quadraticCurveTo(-202, -91, -188, -112);
      ctx.quadraticCurveTo(-182, -125, -157, -125);
      ctx.lineTo(41, -125); ctx.quadraticCurveTo(55, -125, 65, -115);
      ctx.lineTo(111, -73); ctx.lineTo(183, -66);
      ctx.quadraticCurveTo(202, -63, 207, -46);
      ctx.lineTo(213, -19); ctx.quadraticCurveTo(216, 5, 204, 13);
      ctx.lineTo(167, 13);
      ctx.bezierCurveTo(174, -44, 84, -44, 89, 13);
      ctx.lineTo(-92, 13);
      ctx.bezierCurveTo(-88, -44, -175, -44, -168, 13);
      ctx.closePath();
    };
    shape(C.body, bodyPath);

    // Broad flat light/shadow bands, matching the truck rather than photo lighting.
    ctx.save(); ctx.beginPath(); bodyPath(); ctx.clip();
    shape(C.light, () => {
      ctx.moveTo(-200, -67); ctx.lineTo(107, -69); ctx.lineTo(197, -59);
      ctx.lineTo(200, -51); ctx.lineTo(104, -59); ctx.lineTo(-202, -56);
    }, false);
    shape(C.shade, () => {
      ctx.moveTo(-209, -24); ctx.quadraticCurveTo(-44, -13, 214, -23);
      ctx.lineTo(216, 17); ctx.lineTo(-211, 17);
    }, false);
    shape(C.deep, () => {
      ctx.moveTo(-208, 3); ctx.lineTo(215, 3); ctx.lineTo(215, 15); ctx.lineTo(-208, 15);
    }, false);
    ctx.restore();
    line(C.light, 3, () => {
      ctx.moveTo(-170, -119); ctx.lineTo(38, -119);
      ctx.quadraticCurveTo(50, -119, 61, -109);
    });

    // Rear quarter glass; rear passenger glass; dark open driver's window.
    shape(C.rearGlass, () => {
      ctx.moveTo(-182, -77); ctx.lineTo(-169, -112);
      ctx.lineTo(-120, -113); ctx.lineTo(-115, -73); ctx.lineTo(-179, -73);
    });
    shape(C.glass, () => {
      ctx.moveTo(-108, -113); ctx.lineTo(-29, -114);
      ctx.lineTo(-22, -73); ctx.lineTo(-106, -73);
    });
    // Seats seen through the rear glass, with just one flat shadow each.
    shape(C.deep, () => {
      ctx.moveTo(-96, -75); ctx.lineTo(-95, -90);
      ctx.quadraticCurveTo(-95, -96, -85, -96);
      ctx.quadraticCurveTo(-77, -96, -77, -87); ctx.lineTo(-75, -75);
    }, false);
    shape(C.rearGlass, () => {
      ctx.moveTo(-63, -113); ctx.lineTo(-48, -113);
      ctx.lineTo(-76, -74); ctx.lineTo(-91, -74);
    }, false);
    line(C.cream, 1.7, () => {
      ctx.moveTo(-162, -105); ctx.lineTo(-168, -87);
      ctx.moveTo(-98, -105); ctx.lineTo(-80, -105);
    });
    shape(INK, () => {
      ctx.moveTo(-17, -114); ctx.lineTo(36, -114);
      ctx.quadraticCurveTo(42, -114, 48, -108);
      ctx.lineTo(91, -73); ctx.lineTo(-10, -73);
    });
    shape(C.glass, () => {
      ctx.moveTo(48, -110); ctx.lineTo(55, -107);
      ctx.lineTo(99, -72); ctx.lineTo(90, -72);
    });
    line(C.cream, 1.6, () => { ctx.moveTo(67, -94); ctx.lineTo(83, -81); });
    box(-12, -95, 21, 27, 7, C.tyre);
    box(-9, -103, 15, 11, 4, C.deep);
    // Steering wheel stays behind the driver, inside the window.
    line(C.tyre, 3, () => { ctx.ellipse(75, -74, 5, 12, -0.4, 0, TAU); });

    // Roof aerial, hatch seam and slim vertically stacked rear lamp.
    line(INK, 1.7, () => { ctx.moveTo(-113, -126); ctx.lineTo(-121, -145); });
    box(-119, -129, 10, 4, 2, C.deep);
    line(INK, 1.5, () => {
      ctx.moveTo(-190, -90); ctx.lineTo(-190, -46);
      ctx.moveTo(-189, -24); ctx.lineTo(-189, -3);
    });
    shape(C.red, () => {
      ctx.moveTo(-198, -85); ctx.lineTo(-192, -92);
      ctx.lineTo(-189, -41); ctx.lineTo(-202, -41);
    });
    shape(C.cream, () => {
      ctx.moveTo(-200, -58); ctx.lineTo(-191, -58);
      ctx.lineTo(-190, -50); ctx.lineTo(-201, -50);
    }, false);
    line(C.redLight, 2, () => { ctx.moveTo(-197, -78); ctx.lineTo(-195, -65); });

    // Door seams, handles and the reference car's long protective side moulding.
    line(INK, 1.5, () => {
      ctx.moveTo(-112, -71); ctx.lineTo(-108, -42);
      ctx.moveTo(-17, -71); ctx.lineTo(-15, -3);
      ctx.quadraticCurveTo(-17, 2, -24, 2); ctx.lineTo(-88, 2);
      ctx.moveTo(93, -68); ctx.lineTo(83, -7);
      ctx.quadraticCurveTo(82, 1, 75, 1); ctx.lineTo(-14, 1);
    });
    box(-157, -61, 17, 14, 3, C.body);
    box(-97, -57, 18, 5, 2, C.deep);
    box(-4, -57, 18, 5, 2, C.deep);
    line(C.light, 1.4, () => {
      ctx.moveTo(-94, -56); ctx.lineTo(-85, -56);
      ctx.moveTo(-1, -56); ctx.lineTo(8, -56);
    });
    box(-91, -25, 174, 6, 2, C.deep);
    line(C.light, 1.4, () => { ctx.moveTo(-87, -23); ctx.lineTo(78, -23); });
    box(179, -27, 26, 5, 2, C.deep);
    box(-204, -27, 31, 5, 2, C.deep);
    oval(109, -50, 3, 2, C.amber);

    // Headlight wraps around the front corner; no front-facing grille is invented.
    shape(C.cream, () => {
      ctx.moveTo(173, -60); ctx.lineTo(193, -57);
      ctx.quadraticCurveTo(201, -54, 204, -44);
      ctx.lineTo(178, -44); ctx.lineTo(163, -48);
    });
    shape(C.amber, () => {
      ctx.moveTo(192, -56); ctx.quadraticCurveTo(201, -53, 202, -45);
      ctx.lineTo(193, -45);
    }, false);
    line(C.rimShade, 1.3, () => { ctx.moveTo(176, -55); ctx.lineTo(175, -48); });
    box(196, -12, 12, 8, 3, C.tyre);
    oval(202, -8, 3, 2.5, C.cream, false);
    line(INK, 1.5, () => { ctx.moveTo(120, -69); ctx.lineTo(178, -63); });

    // Wheel arches use the same modest outlines as the truck.
    line(C.light, 3, () => {
      ctx.moveTo(-168, -6); ctx.bezierCurveTo(-165, -44, -99, -44, -92, -6);
      ctx.moveTo(91, -6); ctx.bezierCurveTo(97, -43, 160, -43, 166, -6);
    });

    // Blue-shirted shoulder inside the opening, before the portrait leans outside.
    shape(C.shirt, () => {
      ctx.moveTo(-1, -70); ctx.lineTo(4, -83);
      ctx.quadraticCurveTo(22, -91, 40, -76);
      ctx.lineTo(51, -62); ctx.lineTo(10, -61);
    });
    if (this.head) {
      const h = this.headHeight;
      const w = h * this.head.naturalWidth / this.head.naturalHeight;
      ctx.save(); ctx.translate(29, -68); ctx.rotate(pose.headLean);
      // Portrait looks left; reflect it to face forward in right-facing geometry.
      ctx.scale(-1, 1);
      ctx.drawImage(this.head, -w / 2, -h + 5, w, h);
      ctx.restore();
    }
    // Lower neck is masked by the outside of the door, then the forearm overlaps it.
    box(14, -69, 69, 15, 0, C.body, false);
    box(-9, -73, 105, 5, 2, C.deep);
    line(C.light, 1.4, () => { ctx.moveTo(-6, -68); ctx.lineTo(91, -68); });
    shape(C.shirt, () => {
      ctx.moveTo(1, -79); ctx.quadraticCurveTo(12, -85, 24, -76);
      ctx.lineTo(30, -65); ctx.lineTo(15, -58); ctx.lineTo(2, -65);
    });
    shape(C.shirtDark, () => {
      ctx.moveTo(2, -66); ctx.lineTo(16, -62); ctx.lineTo(26, -67);
      ctx.lineTo(29, -64); ctx.lineTo(15, -58);
    }, false);
    shape(C.skin, () => {
      ctx.moveTo(19, -67); ctx.lineTo(29, -69);
      ctx.quadraticCurveTo(35, -61, 44, -60);
      ctx.lineTo(66, -63); ctx.quadraticCurveTo(75, -65, 78, -58);
      ctx.quadraticCurveTo(82, -52, 73, -49);
      ctx.lineTo(45, -47); ctx.quadraticCurveTo(24, -47, 14, -59);
    });
    shape(C.skinShade, () => {
      ctx.moveTo(17, -58); ctx.quadraticCurveTo(35, -51, 49, -52);
      ctx.lineTo(78, -55); ctx.quadraticCurveTo(77, -49, 69, -49);
      ctx.lineTo(45, -48); ctx.quadraticCurveTo(28, -47, 17, -58);
    }, false);
    line(INK, 1.3, () => {
      ctx.moveTo(70, -60); ctx.lineTo(72, -54);
      ctx.moveTo(74, -60); ctx.lineTo(76, -55);
    });

    // Side mirror sits forward of the driver's hand and face.
    shape(C.deep, () => {
      ctx.moveTo(89, -74); ctx.lineTo(105, -79); ctx.lineTo(112, -71);
      ctx.lineTo(96, -65); ctx.lineTo(88, -66);
    });
    shape(C.body, () => {
      ctx.moveTo(98, -86); ctx.quadraticCurveTo(111, -92, 122, -84);
      ctx.lineTo(124, -72); ctx.quadraticCurveTo(107, -69, 99, -74);
    });
    line(C.light, 2, () => { ctx.moveTo(104, -85); ctx.quadraticCurveTo(113, -87, 118, -82); });

    ctx.restore();
    ctx.restore();
  }
}

export default NPCNidjo;
