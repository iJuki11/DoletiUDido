(function(root){
  'use strict';
  const mod=(n,p)=>((n%p)+p)%p;
  const CITY_WORLD_LENGTH=4500;
  function repeats(o,loop){return o.repeat==='loop'||(o.repeat==='auto'&&o.x>=loop.start&&o.x<loop.end);}
  // Coordinates are scene pixels. A depth-scaled object uses a depth-scaled loop period.
  function instances(o,loop,minX,maxX,periodic=true,period=loop.end-loop.start){
    if(!periodic||!repeats(o,loop)||!(period>0))return o.x+o.width>=minX&&o.x<=maxX?[{x:o.x,copy:0,clipLeft:null}]:[];
    const base=loop.start+mod(o.x-loop.start,period),out=[];
    const first=Math.ceil((Math.max(minX,loop.start)-base-o.width)/period),last=Math.floor((maxX-base)/period);
    for(let k=first;k<=last;k++){const x=base+k*period;if(x+o.width>loop.start)out.push({x,copy:x-o.x,clipLeft:loop.start});}
    return out;
  }
  function paint(ctx,img,o,x){
    ctx.save();ctx.globalAlpha*=o.opacity??1;
    ctx.translate(x+(o.flipX?o.width:0),o.y+(o.flipY?o.height:0));
    ctx.scale(o.flipX?-1:1,o.flipY?-1:1);ctx.drawImage(img,0,0,o.width,o.height);ctx.restore();
  }
  function render(ctx,scene,images,cameraX=0,options={}){
    const width=options.width??scene.canvas.width,height=options.height??scene.canvas.height;
    const authoredViewport=options.viewportWidth??scene.canvas.width;
    const scale=Math.max(width/authoredViewport,height/scene.canvas.height);
    const viewport=width/scale;
    const verticalOffset=(height/scale-scene.canvas.height)/2;
    ctx.save();ctx.scale(scale,scale);ctx.translate(0,verticalOffset);ctx.beginPath();ctx.rect(0,0,viewport,scene.canvas.height);ctx.clip();
    if(options.clear!==false)ctx.clearRect(0,0,viewport,scene.canvas.height);
    for(const l of scene.layers){
      if(l.visible===false||(options.onlyLayer&&l.id!==options.onlyLayer))continue;
      const depth=Math.max(0,l.parallax??0);
      const offset=options.designOffset!==undefined?options.designOffset:depth*cameraX;
      const period=depth*CITY_WORLD_LENGTH;
      ctx.save();ctx.globalAlpha=l.opacity??1;
      for(const o of l.objects){
        const img=images.get?images.get(o.assetId):images[o.assetId];if(!img||o.visible===false)continue;
        // Depth changes horizontal position and copy spacing only. Object dimensions stay authored.
        const scaledObj={...o,x:depth*o.x,y:o.y,width:o.width,height:o.height};
        for(const p of instances(scaledObj,scene.loop,offset,offset+viewport,period>0,period)){
          ctx.save();if(p.clipLeft!==null){ctx.beginPath();ctx.rect(p.clipLeft-offset,0,viewport+Math.abs(offset)+scene.loop.end,scene.canvas.height);ctx.clip();}
          paint(ctx,img,scaledObj,p.x-offset);ctx.restore();
        }
      }ctx.restore();
    }ctx.restore();
  }
  const api={instances,repeats,paint,render};root.ParallaxRuntime=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);