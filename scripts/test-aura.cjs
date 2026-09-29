const assert = require('node:assert/strict');
const { distanceField, render } = require('../public/aura-engine.js');
// Compare the fast transform with a brute-force geometric oracle, including
// disconnected subjects and masks touching the image edge.
for (const points of [[[3,4]], [[0,0],[8,6]], [[2,2],[2,3],[3,2],[7,5]]]) {
  const w=9,h=7,alpha=new Uint8Array(w*h);
  points.forEach(([x,y])=>alpha[y*w+x]=255);
  const result=distanceField(alpha,w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const expected=Math.min(...points.map(([px,py])=>Math.hypot(x-px,y-py)));
    assert.ok(Math.abs(result.distance[y*w+x]-expected)<1e-5,`Distance mismatch at ${x},${y}`);
  }
}
assert.equal(distanceField(new Uint8Array(36),6,6),null);
assert.throws(()=>distanceField(new Uint8Array(4),6,6));
const w=101,alpha=new Uint8Array(w*w);alpha[50*w+50]=255;
const field=distanceField(alpha,w,w);
const settings={count:2,gap:8,thickness:4,spacing:10,roughness:0,seed:7,colors:['#ff0000','#00ff00','#0000ff'],multicolor:true};
const rgba=render(field,w,w,settings,w);
const pixel=(x,y)=>Array.from(rgba.slice((y*w+x)*4,(y*w+x)*4+4));
assert.deepEqual(pixel(50,50),[0,0,0,0],'Subject must not be painted');
assert.deepEqual(pixel(60,50),[255,0,0,255],'First ring uses primary ink');
assert.deepEqual(pixel(74,50),[0,255,0,255],'Second ring uses alternate ink');
assert.equal(pixel(66,50)[3],0,'Space between rings stays clear');
assert.equal(pixel(88,50)[3],0,'No extra rings beyond requested count');
assert.deepEqual(render(field,w,w,{...settings,roughness:80},w),render(field,w,w,{...settings,roughness:80},w),'Paint texture must be stable');
assert.notDeepEqual(render(field,w,w,{...settings,roughness:80},w),render(field,w,w,{...settings,roughness:80,seed:8},w),'Reroll must change the brush texture');
const large=render(field,202,202,settings,w);
assert.equal(large[(100*202+120)*4],255,'Export scaling retains the first ring');
console.log('Contour Aura: geometry, empty masks, ring count, color cycling, texture stability, and export scaling passed.');
