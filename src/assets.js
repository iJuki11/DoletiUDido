export class AssetLoader {
  constructor() {
    // Resolved images are kept here; pending promises prevent duplicate requests.
    this.cache = new Map();
    this.pending = new Map();
  }

  loadImage(id, src) {
    if (this.cache.has(id)) return Promise.resolve(this.cache.get(id));
    if (this.pending.has(id)) return this.pending.get(id);

    const promise = new Promise((resolve) => {
      const image = new Image();
      const finish = () => {
        this.cache.set(id, image);
        this.pending.delete(id);
        resolve(image);
      };
      image.onload = finish;
      image.onerror = finish;
      image.src = src;
    });
    this.pending.set(id, promise);
    return promise;
  }

  preload(assets = []) {
    return Promise.all(
      assets.map(({ id, src }) => this.loadImage(id, src).catch(() => null)),
    );
  }

  // Loads an SVG once via fetch + DOMParser, then for each requested part id
  // serialises the matching <g> (with the outer transform wrapper, so the
  // part keeps its place inside the SVG coordinate system) into a standalone
  // data: URL image. Each part becomes an Image you can drawImage() per frame.
  //
  // - src: path to the SVG file (e.g. "./assets/images/bird/bird_image.svg")
  // - partIds: array of element ids present in the SVG (e.g. ["body", "wing"])
  //
  // Returns an object { [partId]: HTMLImageElement } once every part has
  // loaded. If the SVG fetch fails or the SVG has no <svg> root, the whole
  // promise rejects — caller should treat that as "no render".
  loadSvgParts(src, partIds) {
    const cacheKey = `svg:${src}:${partIds.join(",")}`;
    if (this.pending.has(cacheKey)) return this.pending.get(cacheKey);

    const promise = (async () => {
      const response = await fetch(src);
      if (!response.ok) {
        throw new Error(`Failed to fetch SVG: ${src} (${response.status})`);
      }
      const svgText = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, "image/svg+xml");
      const svgRoot = doc.querySelector("svg");
      if (!svgRoot) {
        throw new Error(`No <svg> root found in ${src}`);
      }

      // Walk up to find the outermost <g transform="..."> wrapper. Affinity
      // exports apply a single scale+translate matrix here, and every part
      // needs that matrix baked into its own SVG document so it stays in
      // the same coordinate frame as the others.
      const outerGroup = svgRoot.querySelector(":scope > g");

      // Read viewBox once. Source SVG declares width="100%" height="100%"
      // which produces ambiguous natural dimensions when embedded via <img>;
      // we override with explicit pixel dimensions matching the viewBox so
      // every browser agrees the Image is 840x1080.
      const viewBox = svgRoot.getAttribute("viewBox");
      const [vbX, vbY, vbW, vbH] = viewBox
        ? viewBox.split(/\s+/).map(Number)
        : [0, 0, 840, 1080];

      const parts = {};
      const loadPart = (partId) =>
        new Promise((resolvePart) => {
          const target = doc.getElementById(partId);
          if (!target) {
            // Don't fail the whole load — just skip this part.
            // The caller can check parts[id] === undefined to know.
            resolvePart(null);
            return;
          }
          // Clone the node so we can build a fresh, minimal SVG document
          // around just this part.
          const cloned = target.cloneNode(true);
          cloned.removeAttribute("id");

          // Build a fresh <svg> document wrapping the outer transform + this
          // part. Using the original outerGroup preserves the scale/translation
          // so coords line up across all parts.
          const partSvg = doc.implementation
            .createDocument("http://www.w3.org/2000/svg", "svg", null);
          const partRoot = partSvg.documentElement;
          partRoot.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          partRoot.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
          partRoot.setAttribute("width", String(vbW));
          partRoot.setAttribute("height", String(vbH));

          if (outerGroup) {
            // Apply outer transform via a fresh wrapper so the cloned part
            // keeps its position. We do NOT clone the outerGroup's children
            // (those are *every* part) — we add only our cloned target.
            const wrapper = partSvg.createElementNS(
              "http://www.w3.org/2000/svg",
              "g",
            );
            const outerTransform = outerGroup.getAttribute("transform");
            if (outerTransform) wrapper.setAttribute("transform", outerTransform);
            wrapper.appendChild(cloned);
            partRoot.appendChild(wrapper);
          } else {
            partRoot.appendChild(cloned);
          }

          const serializer = new XMLSerializer();
          const serialized = serializer.serializeToString(partSvg);
          const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

          const img = new Image();
          img.onload = () => {
            this.cache.set(`${cacheKey}#${partId}`, img);
            parts[partId] = img;
            resolvePart(img);
          };
          img.onerror = () => {
            resolvePart(null);
          };
          img.src = dataUrl;
        });

      await Promise.all(partIds.map(loadPart));
      return parts;
    })();

    this.pending.set(cacheKey, promise);
    return promise;
  }

  // PERF-FIX #3 — entity prewarm. The browser uploads every fresh
  // HTMLImageElement to the GPU on its first drawImage call, which causes a
  // 50–100 ms hitch on the very first frame each new NPC, airplane, bird,
  // or konobar is drawn. We solve this in two halves:
  //
  //   1. DECODE early: pre-load every entity image into this.cache so the
  //      network/decode cost is paid before gameplay starts, not during
  //      a spawn.
  //   2. UPLOAD early (warmUpRender, in game.js): iterate this.cache and
  //      drawImage every HTMLImageElement once onto an offscreen canvas so
  //      the GPU texture upload happens while the loading screen is still
  //      up.
  //
  // Returns a single Promise that resolves once all loads settle (whether
  // they succeeded or failed). A failure here MUST NOT lock the game on
  // the loading screen — we log and move on. Caller awaits this to gate
  // whenReady(), so the loading overlay only releases once everything
  // pre-loaded below has had a chance to decode.
  prewarmEntities() {
    const started = performance.now();
    // Airplane uses an absolute URL resolved against import.meta.url, not
    // a relative path — loadImage() passes `src` straight to image.src, so
    // any URL form works. For everything else the relative path matches
    // what the spawners already use.
    const airplaneUrl = new URL('../assets/images/cvrka.png', import.meta.url).href;
    const jobs = [
      this.loadImage('airplane-head', airplaneUrl),
      this.loadSvgParts('./assets/images/enemy_bird.svg', [
        'farWing', 'nearWing', 'tail', 'feet', 'body', 'head',
      ]),
      this.loadImage('prsan-head', './assets/images/prsan_head.png'),
      this.loadImage('nidjo-head', './assets/images/nidjo_head.png'),
      this.loadImage('toni-head', './assets/images/toni_head.png'),
      this.loadImage('fabo-i-pacho', './assets/images/fabo_i_pacho.png'),
    ];

    const settled = Promise.all(jobs.map((p) => p.catch(() => null)));
    return settled.then((results) => {
      const elapsed = performance.now() - started;
      // Count successful HTMLImageElements that ended up in the cache.
      let imageCount = 0;
      for (const v of this.cache.values()) {
        if (v instanceof HTMLImageElement && v.complete) imageCount++;
      }
      const failed = results.filter((r) => r === null).length;
      const suffix = failed > 0 ? ` (${failed} failed)` : '';
      console.log(`[assets] prewarmEntities done in ${elapsed.toFixed(0)}ms (${imageCount} images)${suffix}`);
    });
  }
}