/* Shared material rendering for the live canvas and full-resolution exports. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EmbossEngine=api;})(globalThis,()=>{
  'use strict';
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  function hash(x,y,seed=19){let n=Math.imul(x+Math.imul(y,9013)+seed*1013,374761393);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
  function panel(width,height,layout,amount){
    const ratio=clamp(amount/100,.15,.65);
    if(layout==='top'){const split=Math.round(height*ratio);return {photo:{x:0,y:0,width,height:split},paper:{x:0,y:split,width,height:height-split}};}
    if(layout==='bottom'){const split=Math.round(height*(1-ratio));return {photo:{x:0,y:split,width,height:height-split},paper:{x:0,y:0,width,height:split}};}
    if(layout==='left'){const split=Math.round(width*ratio);return {photo:{x:0,y:0,width:split,height},paper:{x:split,y:0,width:width-split,height}};}
    return {photo:null,paper:{x:0,y:0,width,height}};
  }
  function fittedRect(sourceWidth,sourceHeight,region,zoom=100,x=0,y=0,fit='cover'){
    const scale=(fit==='contain'?Math.min(region.width/sourceWidth,region.height/sourceHeight):Math.max(region.width/sourceWidth,region.height/sourceHeight))*zoom/100;
    const width=sourceWidth*scale,height=sourceHeight*scale;
    return {x:region.x+(region.width-width)/2+x*region.width,y:region.y+(region.height-height)/2+y*region.height,width,height};
  }
  function blur(input,width,height,radius){
    const r=Math.max(0,Math.round(radius));if(!r)return new Float32Array(input);
    const temp=new Float32Array(input.length),out=new Float32Array(input.length),count=2*r+1;
    for(let y=0;y<height;y++){
      const row=y*width;let sum=0;
      for(let k=-r;k<=r;k++)sum+=input[row+clamp(k,0,width-1)];
      for(let x=0;x<width;x++){temp[row+x]=sum/count;sum+=input[row+clamp(x+r+1,0,width-1)]-input[row+clamp(x-r,0,width-1)];}
    }
    for(let x=0;x<width;x++){
      let sum=0;for(let k=-r;k<=r;k++)sum+=temp[clamp(k,0,height-1)*width+x];
      for(let y=0;y<height;y++){out[y*width+x]=sum/count;sum+=temp[clamp(y+r+1,0,height-1)*width+x]-temp[clamp(y-r,0,height-1)*width+x];}
    }
    return out;
  }
  function soften(input,width,height,radius){
    const lower=Math.floor(radius),mix=radius-lower;
    const low=blur(input,width,height,lower);if(mix<.001)return low;
    const high=blur(input,width,height,lower+1);
    for(let i=0;i<low.length;i++)low[i]+=(high[i]-low[i])*mix;
    return low;
  }
  function letteringScale(typeSize){return clamp(typeSize/72,.18,1);}
  function heightField(alpha,width,height,bevel,unit){
    const input=new Float32Array(width*height);
    for(let i=0;i<input.length;i++)input[i]=alpha[i*4+3]/255;
    const r=Math.max(.3,(.6+bevel/100*3)*unit);
    return soften(soften(input,width,height,r),width,height,r);
  }
  function lightVector(angle){const rad=angle*Math.PI/180;return {x:Math.cos(rad)*.72,y:Math.sin(rad)*.72,z:.694};}
  function reliefAt(field,width,height,x,y,depth,unit,mode,light){
    if(!depth)return 0;
    const i=y*width+x;
    const direction=mode==='deboss'?-1:1,amplitude=depth/100*9*unit*direction;
    const dx=(field[y*width+Math.min(width-1,x+1)]-field[y*width+Math.max(0,x-1)])*.5*amplitude;
    const dy=(field[Math.min(height-1,y+1)*width+x]-field[Math.max(0,y-1)*width+x])*.5*amplitude;
    const normal=Math.sqrt(dx*dx+dy*dy+1);
    // Neutral, uninked paper has the same brightness on flat glyphs and flat stock.
    return (-dx*light.x-dy*light.y+light.z)/normal-light.z;
  }
  function shade(pixels,width,height,field,settings,region,unit=1){
    const rgb=settings.paper.match(/[\da-f]{2}/gi).map(h=>parseInt(h,16)),light=lightVector(settings.angle),seed=settings.seed||19;
    const rx=Math.max(0,Math.round(region.x)),ry=Math.max(0,Math.round(region.y)),ex=Math.min(width,Math.round(region.x+region.width)),ey=Math.min(height,Math.round(region.y+region.height));
    for(let y=ry;y<ey;y++)for(let x=rx;x<ex;x++){
      const nx=(x-region.x)/region.width-.5,ny=(y-region.y)/region.height-.5;
      const illumination=settings.wash/100*(.70*(nx*light.x+ny*light.y)+.10*Math.sin(nx*5.1+ny*4.7));
      const relief=reliefAt(field,width,height,x,y,settings.depth,unit,settings.relief,light)*settings.strength/100;
      const gx=Math.floor(x/unit),gy=Math.floor(y/unit);
      const fine=hash(gx,gy,seed)-.5,coarse=hash(Math.floor(gx/3),Math.floor(gy/3),seed+11)-.5;
      const fiber=Math.sin(gx*.66+Math.sin(gy*.071)*2)*.8;
      const grain=(fine*19+coarse*7+fiber*1.7)*settings.grain/100;
      const tone=illumination+relief*.8,i=(y*width+x)*4;
      for(let c=0;c<3;c++)pixels[i+c]=clamp((tone>0?rgb[c]+(255-rgb[c])*tone:rgb[c]*(1+tone))+grain,0,255);
      pixels[i+3]=255;
    }
  }
  function photoTreatment(pixels,width,height,region,settings,unit=1){
    const rx=Math.max(0,Math.round(region.x)),ry=Math.max(0,Math.round(region.y)),ex=Math.min(width,Math.round(region.x+region.width)),ey=Math.min(height,Math.round(region.y+region.height));
    const gray=settings.photoMono/100,contrast=1+settings.photoContrast/100;
    for(let y=ry;y<ey;y++)for(let x=rx;x<ex;x++){
      const i=(y*width+x)*4,lum=pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722;
      const grain=(hash(Math.floor(x/unit),Math.floor(y/unit),settings.seed)-.5)*settings.photoGrain*.32;
      for(let c=0;c<3;c++)pixels[i+c]=((pixels[i+c]*(1-gray)+lum*gray)-128)*contrast+128+grain;
    }
  }
  return {panel,fittedRect,blur,heightField,letteringScale,lightVector,reliefAt,shade,photoTreatment};
});
