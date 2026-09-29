const assert=require('node:assert/strict'),E=require('../public/collage-engine.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
for(const rotation of [-180,-90,-37,0,21,90,180]){
 const r={x:410,y:325,width:230,height:140,rotation},p={x:23,y:-35},q=E.local(E.world(p,r),r);close(q.x,p.x);close(q.y,p.y);
 assert.ok(E.hit(E.world(p,r),r));assert.ok(!E.hit(E.world({x:200,y:0},r),r));
 const h=E.handles(r);close(E.local(h.resize,r).x,115);close(E.local(h.rotate,r).y,-100);
}
// Filling a frame at every crop extreme must leave no uncovered edge.
for(const [sw,sh,w,h] of [[1600,900,300,500],[700,1200,600,220],[900,900,600,600]])for(const zoom of [100,180,400])for(const x of [-1,0,1])for(const y of [-1,0,1]){
 const r=E.fittedRect(sw,sh,w,h,zoom,x,y);assert.ok(r.x<=-w/2+1e-7&&r.y<=-h/2+1e-7);assert.ok(r.x+r.width>=w/2-1e-7&&r.y+r.height>=h/2-1e-7);
}
const fit=E.fittedRect(1600,900,400,400,100,0,0,'contain');close(fit.width,400);close(fit.height,225);
const a=E.preset(),layer=a.layers[0],small=E.frame(layer,900,900,7),large=E.frame(layer,3000,3000,7);
for(const k of ['x','y','width','height'])close(large[k]/small[k],3000/900);
E.reorder(a.layers,'main',1);assert.equal(a.layers[1].id,'main');E.reorder(a.layers,'main',-1);assert.equal(a.layers[0].id,'main');E.reorder(a.layers,'main',-1);assert.equal(a.layers[0].id,'main');
assert.equal(E.preset('detail').margin,0);assert.equal(E.preset('detail').layers.filter(l=>l.visible&&l.kind==='text').length,0);
a.layers[0].x=100;assert.equal(E.preset().layers[0].x,.65,'Presets must not share mutable layer objects');
console.log('Collage: rotated hit areas/handles, bounded crops, whole-image fit, export scaling, layer ordering, and independent presets passed.');
