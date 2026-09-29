/* Deterministic word placement, shared by preview and full-resolution exports. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TextFieldEngine=api;})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function random(seed){let n=seed>>>0;return()=>{n+=0x6D2B79F5;let t=Math.imul(n^n>>>15,1|n);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
  function tokens(text,unit='word'){return text.split(unit==='line'?/\r?\n/:/\s+/u).map(s=>s.trim()).filter(Boolean);}
  function intersectsEllipse(b,z){
    if(!z||!z.enabled)return false;
    const dx=(clamp(z.x,b.x,b.x+b.width)-z.x)/z.rx,dy=(clamp(z.y,b.y,b.y+b.height)-z.y)/z.ry;
    return dx*dx+dy*dy<=1;
  }
  function layout(o,measure){
    const words=tokens(o.text,o.unit),items=[],w=o.width,h=o.height,short=Math.min(w,h),scale=short/900;
    const margin=short*o.margin/100,cols=o.columns,cell=(w-2*margin)/cols,size=o.size*scale;
    const rowHeight=size*o.rowGap/100,rows=Math.max(1,Math.floor((h-2*margin)/rowHeight)),rand=random(o.seed);
    const zone=o.clear?{enabled:true,x:o.clearX*w,y:o.clearY*h,rx:o.clearWidth*w/200,ry:o.clearHeight*h/200}:null;
    let used=0,small=0;
    if(!words.length)return {items,total:0,used:0,small:0};
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      const chance=rand(),rx=rand(),ry=rand();
      if(chance>o.density/100||items.length>=800||(!o.repeat&&used>=words.length))continue;
      const text=words[used%words.length],natural=Math.max(1,measure(text,size)),fit=Math.min(1,(cell*.9)/natural);
      const width=natural*fit,height=size*fit*1.3;
      const b={id:row*cols+col,text,index:used%words.length,size:size*fit,width,height,
        x:margin+col*cell+(cell-width)/2+(rx-.5)*(cell-width)*o.jitter/100*.9,
        y:margin+(row+.5)*rowHeight-height/2+(ry-.5)*Math.max(0,rowHeight-height)*o.jitter/100*.85};
      if(intersectsEllipse(b,zone))continue;
      const offset=o.offsets?.[b.id];
      if(offset){b.x=clamp(b.x+offset.x*w,margin,w-margin-width);b.y=clamp(b.y+offset.y*h,margin,h-margin-height);}
      if(fit<.65)small++;
      items.push(b);used++;
    }
    return {items,total:words.length,used:Math.min(used,words.length),small};
  }
  function fittedRect(sw,sh,w,h,zoom=100,x=0,y=0,fit='cover'){
    const scale=(fit==='contain'?Math.min(w/sw,h/sh):Math.max(w/sw,h/sh))*zoom/100;
    return {width:sw*scale,height:sh*scale,x:(w-sw*scale)/2+x*w,y:(h-sh*scale)/2+y*h};
  }
  function contrastColor(r,g,b){const c=[r,g,b].map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2]>.179?'#171914':'#ffffff';}
  return {layout,tokens,random,intersectsEllipse,fittedRect,contrastColor};
});
