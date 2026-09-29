/* Weave geometry is shared by preview, export, and the topology tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WeaveEngine = api;
})(globalThis, () => {
  'use strict';
  function noise(index, seed) {
    let n = Math.imul(index + seed * 1013, 374761393);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  function verticalOver(row, column, pattern = 'plain', flip = false) {
    let over;
    if (pattern === 'basket') over = (Math.floor(row / 2) + Math.floor(column / 2)) % 2 === 0;
    else if (pattern === 'twill') over = ((column - row) % 4 + 4) % 4 < 2;
    else over = (row + column) % 2 === 0;
    return flip ? !over : over;
  }
  function plan(width, height, settings) {
    const unit = Math.min(width, height) / 900;
    const strip = settings.strip * unit, gap = settings.gap * unit, pitch = strip + gap;
    const margin = Math.min(width, height) * settings.margin / 100;
    const columns = Math.max(1, Math.floor((width - 2 * margin + gap) / pitch));
    const rows = Math.max(1, Math.floor((height - 2 * margin + gap) / pitch));
    const spanX = columns * pitch - gap, spanY = rows * pitch - gap;
    const fringe = settings.fringe * unit;
    const bounds = { x:(width-spanX)/2-fringe, y:(height-spanY)/2-fringe, width:spanX+2*fringe, height:spanY+2*fringe };
    function strand(axis, index, count, span, length) {
      const key = index + (axis === 'v' ? 2000 : 4000);
      const along = (noise(key,settings.seed)-.5) * 2 * settings.offset * unit;
      const across = (noise(key+1000,settings.seed)-.5) * Math.min(gap*.7,settings.offset*unit*.2);
      const baseX = axis === 'v' ? (width-span)/2+strip/2+index*pitch : width/2;
      const baseY = axis === 'h' ? (height-span)/2+strip/2+index*pitch : height/2;
      return { axis,index,baseX,baseY,cx:baseX+(axis==='v'?across:along),cy:baseY+(axis==='v'?along:across),
        width:axis==='v'?strip:length, height:axis==='h'?strip:length,
        angle:(noise(key+500,settings.seed)-.5)*2*settings.tilt*Math.PI/180 };
    }
    const vertical = Array.from({length:columns},(_,i)=>strand('v',i,columns,spanX,spanY+2*fringe));
    const horizontal = Array.from({length:rows},(_,i)=>strand('h',i,rows,spanY,spanX+2*fringe));
    return {width,height,unit,rows,columns,strip,gap,bounds,vertical,horizontal};
  }
  function corners(strip) {
    const c=Math.cos(strip.angle),s=Math.sin(strip.angle);
    return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({x:strip.cx+x*strip.width/2*c-y*strip.height/2*s,y:strip.cy+x*strip.width/2*s+y*strip.height/2*c}));
  }
  function path(ctx,strip) {
    const p=corners(strip);ctx.moveTo(p[0].x,p[0].y);
    for(let i=1;i<4;i++)ctx.lineTo(p[i].x,p[i].y);
    ctx.closePath();
  }
  function intersection(v,h) {
    const vx=-Math.sin(v.angle),vy=Math.cos(v.angle),hx=Math.cos(h.angle),hy=Math.sin(h.angle);
    const dx=h.cx-v.cx,dy=h.cy-v.cy,det=vx*hy-vy*hx;
    const t=(dx*hy-dy*hx)/det;
    return {x:v.cx+t*vx,y:v.cy+t*vy};
  }
  function drawStrip(ctx,strip,photo,width,height,shade,background) {
    ctx.save();ctx.translate(strip.cx,strip.cy);ctx.rotate(strip.angle);
    ctx.beginPath();ctx.rect(-strip.width/2,-strip.height/2,strip.width,strip.height);ctx.clip();
    // Move the original crop with its paper strip, rather than resampling each cell.
    ctx.fillStyle=background;ctx.fillRect(-strip.width/2,-strip.height/2,strip.width,strip.height);
    ctx.drawImage(photo,-strip.baseX,-strip.baseY,width,height);
    if(shade) {
      const horizontal=strip.axis==='h';
      const gradient=horizontal?ctx.createLinearGradient(0,-strip.height/2,0,strip.height/2):ctx.createLinearGradient(-strip.width/2,0,strip.width/2,0);
      gradient.addColorStop(0,`rgba(255,255,255,${shade*.17})`);
      gradient.addColorStop(.18,'rgba(255,255,255,0)');
      gradient.addColorStop(.8,'rgba(0,0,0,0)');
      gradient.addColorStop(1,`rgba(0,0,0,${shade*.12})`);
      ctx.fillStyle=gradient;ctx.fillRect(-strip.width/2,-strip.height/2,strip.width,strip.height);
    }
    ctx.restore();
  }
  function setShadow(ctx,strength,unit) {
    ctx.shadowColor=`rgba(24,22,16,${strength*.36})`;
    ctx.shadowBlur=(1.5+strength*6)*unit;
    ctx.shadowOffsetX=1.4*strength*unit;ctx.shadowOffsetY=3*strength*unit;
    ctx.fillStyle='#171914';
  }
  function render(ctx,photoA,photoB,width,height,settings,pixelScale=1) {
    const layout=plan(width,height,settings), strength=settings.shadow/100;
    const strands=[...layout.vertical,...layout.horizontal];
    ctx.fillStyle=settings.background;ctx.fillRect(0,0,width,height);
    if(strength) {
      ctx.save();setShadow(ctx,strength,layout.unit*pixelScale);
      for(const strip of strands){ctx.beginPath();path(ctx,strip);ctx.fill();}
      ctx.restore();
    }
    for(const strip of layout.vertical)drawStrip(ctx,strip,photoA,width,height,strength,settings.background);
    for(const strip of layout.horizontal)drawStrip(ctx,strip,photoB,width,height,strength,settings.background);
    for(const h of layout.horizontal)for(const v of layout.vertical) {
      if(!verticalOver(h.index,v.index,settings.pattern,settings.flip))continue;
      ctx.save();ctx.beginPath();path(ctx,h);ctx.clip();drawStrip(ctx,v,photoA,width,height,strength,settings.background);ctx.restore();
    }
    // Cast each crossing's shadow only onto the exposed portion of its lower strip.
    // This avoids painting shadows onto the upper strip or flattening the weave order.
    if(strength)for(const h of layout.horizontal)for(const v of layout.vertical) {
      const vTop=verticalOver(h.index,v.index,settings.pattern,settings.flip),over=vTop?v:h,under=vTop?h:v;
      const p=intersection(v,h),c=Math.cos(over.angle),s=Math.sin(over.angle);
      const localX=(p.x-over.cx)*c+(p.y-over.cy)*s,localY=-(p.x-over.cx)*s+(p.y-over.cy)*c;
      const reach=layout.strip/2+(12+strength*14)*layout.unit;
      ctx.save();ctx.beginPath();path(ctx,under);ctx.clip();
      ctx.beginPath();ctx.rect(-width,-height,width*3,height*3);path(ctx,over);ctx.clip('evenodd');
      setShadow(ctx,strength,layout.unit*pixelScale);
      ctx.translate(over.cx,over.cy);ctx.rotate(over.angle);
      if(over.axis==='v') {
        const start=Math.max(-over.height/2,localY-reach),end=Math.min(over.height/2,localY+reach);
        if(end>start)ctx.fillRect(-over.width/2,start,over.width,end-start);
      } else {
        const start=Math.max(-over.width/2,localX-reach),end=Math.min(over.width/2,localX+reach);
        if(end>start)ctx.fillRect(start,-over.height/2,end-start,over.height);
      }
      ctx.restore();
    }
    return layout;
  }
  function texture(pixels,width,height,amount,seed,unit=1) {
    if(!amount)return;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const gx=Math.floor(x/unit),gy=Math.floor(y/unit);
      const grain=(noise(gx+Math.imul(gy,9013),seed)-.5)*amount*.35;
      const fiber=Math.sin(gx*.41+Math.sin(gy*.033)*2)*amount*.013;
      const i=(y*width+x)*4;
      for(let c=0;c<3;c++)pixels[i+c]+=grain+fiber;
    }
  }
  return {plan,corners,intersection,verticalOver,render,texture};
});
