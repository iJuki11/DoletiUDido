// cameraX and the world use manifest.canvas pixels. Render into any viewport.
export async function loadParallax(baseUrl = './') {
  const base = new URL(baseUrl, location.href);
  const response = await fetch(new URL('manifest.json', base));
  if (!response.ok) throw new Error(`Cannot load parallax manifest: ${response.status}`);
  const manifest = await response.json();
  const assets = await Promise.all(manifest.layers.map(async layer => {
    const image = new Image();
    image.src = new URL(layer.file, base);
    await image.decode();
    return { ...layer, image };
  }));
  return {
    manifest,
    draw(ctx, cameraX, {width=ctx.canvas.width, height=ctx.canvas.height, enabled={}, speeds={}}={}) {
      const W=manifest.canvas.width, H=manifest.canvas.height;
      ctx.save();
      ctx.scale(width/W,height/H);
      ctx.beginPath(); ctx.rect(0,0,W,H); ctx.clip();
      ctx.globalAlpha=1;
      for (const layer of assets) {
        if (enabled[layer.id]===false) continue;
        if (layer.repeat==='fixed') { ctx.drawImage(layer.image,0,0,W,H); continue; }
        const offset=cameraX*(speeds[layer.id]??layer.parallax);
        const first=Math.floor(offset/W);
        for (let tile=first;tile<=first+1;tile++) {
          const x=tile*W-offset;
          ctx.save();
          if(layer.repeat==='mirror' && Math.abs(tile%2)===1) {
            ctx.translate(x+W,0);ctx.scale(-1,1);ctx.drawImage(layer.image,0,0,W,H);
          } else ctx.drawImage(layer.image,x,0,W,H);
          ctx.restore();
        }
      }
      ctx.restore();
    }
  };
}
