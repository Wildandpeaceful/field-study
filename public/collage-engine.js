/* Geometry shared by the collage preview, direct manipulation, and exports. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CollageEngine=api;})(globalThis,()=>{
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function area(width,height,margin=0){const inset=Math.min(width,height)*margin/100;return{x:inset,y:inset,width:width-2*inset,height:height-2*inset};}
  function frame(layer,width,height,margin=0){const r=area(width,height,margin);return{x:r.x+layer.x*r.width,y:r.y+layer.y*r.height,width:layer.w*r.width,height:layer.h*r.height,rotation:layer.rotation||0};}
  function local(p,r){const a=-r.rotation*Math.PI/180,dx=p.x-r.x,dy=p.y-r.y;return{x:dx*Math.cos(a)-dy*Math.sin(a),y:dx*Math.sin(a)+dy*Math.cos(a)};}
  function world(p,r){const a=r.rotation*Math.PI/180;return{x:r.x+p.x*Math.cos(a)-p.y*Math.sin(a),y:r.y+p.x*Math.sin(a)+p.y*Math.cos(a)};}
  function hit(p,r,pad=0){const q=local(p,r);return Math.abs(q.x)<=r.width/2+pad&&Math.abs(q.y)<=r.height/2+pad;}
  function handles(r,gap=30){return{corners:[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>world({x:x*r.width/2,y:y*r.height/2},r)),resize:world({x:r.width/2,y:r.height/2},r),rotate:world({x:0,y:-r.height/2-gap},r),top:world({x:0,y:-r.height/2},r)};}
  function fittedRect(sw,sh,width,height,zoom=100,x=0,y=0,fit='cover'){
    const scale=(fit==='contain'?Math.min(width/sw,height/sh):Math.max(width/sw,height/sh))*zoom/100,w=sw*scale,h=sh*scale;
    return{x:-w/2+clamp(x,-1,1)*Math.abs(w-width)/2,y:-h/2+clamp(y,-1,1)*Math.abs(h-height)/2,width:w,height:h,travelX:Math.abs(w-width)/2,travelY:Math.abs(h-height)/2};
  }
  function reorder(layers,id,direction){const i=layers.findIndex(l=>l.id===id),j=clamp(i+direction,0,layers.length-1);if(i>=0&&i!==j){const [layer]=layers.splice(i,1);layers.splice(j,0,layer);}return layers;}
  function preset(name='stack'){
    const photo=(id,label,x,y,w,h,extra={})=>({id,label,kind:'photo',x,y,w,h,rotation:0,opacity:100,visible:true,zoom:100,cropX:0,cropY:0,fit:'cover',mono:0,border:0,shadow:0,...extra});
    const type=(id,label,text,x,y,size,extra={})=>({id,label,kind:'text',text,x,y,w:.8,h:.2,size,font:'bold',color:'#d51719',tracking:-5,leading:90,rotation:90,opacity:100,visible:true,align:'center',...extra});
    const layers=[photo('main','Main photo',.65,.38,.63,.60),type('title','Album title','after',.28,.40,185),photo('detail','Detail photo',.32,.71,.50,.34,{rotation:-2,mono:100,border:5,shadow:18}),photo('extra','Third photo',.75,.75,.30,.25,{visible:false,rotation:6}),type('artist','Artist / edition','DAWN ARCHIVE / VOL. 01',.50,.95,17,{rotation:0,color:'#242320',tracking:2,leading:120,font:'mono'})];
    if(name==='detail'){
      Object.assign(layers[0],{x:.5,y:.5,w:1,h:1,zoom:185});
      Object.assign(layers[2],{x:.62,y:.42,w:.36,h:.39,rotation:0,mono:0,border:0,shadow:0});
      layers[1].visible=false;layers[4].visible=false;
    }
    return{layers,background:'#f1f0eb',margin:name==='detail'?0:7,grain:name==='detail'?0:14,preset:name};
  }
  function noise(x,y){let n=Math.imul(x+Math.imul(y,9013)+19019,374761393);n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967295;}
  return{clamp,area,frame,local,world,hit,handles,fittedRect,reorder,preset,noise};
});
