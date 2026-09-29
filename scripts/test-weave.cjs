const assert=require('node:assert/strict');
const {plan,corners,intersection,verticalOver,texture}=require('../public/weave-engine.js');
const settings={strip:72,gap:7,margin:7,fringe:16,offset:0,tilt:0,seed:7};
for(let row=0;row<8;row++)for(let col=0;col<8;col++){
  const current=verticalOver(row,col);
  assert.notEqual(current,verticalOver(row+1,col),'Plain weave must alternate along each column.');
  assert.notEqual(current,verticalOver(row,col+1),'Plain weave must alternate along each row.');
  assert.notEqual(current,verticalOver(row,col,'plain',true),'Flip must reverse every crossing.');
  assert.equal(verticalOver(row,col,'basket'),verticalOver(row^1,col^1,'basket'),'Basket weave must form 2×2 groups.');
  assert.equal(verticalOver(row,col,'twill'),verticalOver(row+1,col+1,'twill'),'Twill must advance diagonally.');
}
const p=plan(900,1200,settings);
assert.equal(p.vertical.length,p.columns);assert.equal(p.horizontal.length,p.rows);
for(let i=1;i<p.columns;i++)assert.equal(p.vertical[i].cx-p.vertical[i-1].cx,settings.strip+settings.gap);
for(const v of p.vertical)for(const h of p.horizontal){const point=intersection(v,h);assert.equal(point.x,v.cx);assert.equal(point.y,h.cy);}
for(const strip of [...p.vertical,...p.horizontal])assert.ok(corners(strip).every(p=>p.x>=0&&p.y>=0&&p.x<=900&&p.y<=1200),'Default strip ends must fit on the paper.');
const rough={...settings,offset:12,tilt:1.4};
assert.deepEqual(plan(900,1200,rough),plan(900,1200,rough),'Handmade placement must not jump on every frame.');
assert.notDeepEqual(plan(900,1200,rough),plan(900,1200,{...rough,seed:8}));
const doubled=plan(1800,2400,rough),normal=plan(900,1200,rough);
assert.equal(doubled.columns,normal.columns);assert.equal(doubled.rows,normal.rows);
assert.equal(doubled.vertical[2].cx,normal.vertical[2].cx*2,'Export scaling must preserve the composition.');
const pixels=new Uint8ClampedArray(200*100*4).fill(128),copy=pixels.slice();texture(copy,200,100,0,7);assert.deepEqual(pixels,copy);
texture(copy,200,100,40,7);const second=pixels.slice();texture(second,200,100,40,7);assert.deepEqual(copy,second);
assert.notDeepEqual(copy,pixels);assert.ok(copy.every((v,i)=>i%4!==3||v===128),'Grain must preserve alpha.');
console.log('Paper Weave: alternating crossings, basket/twill topology, spacing, bounds, stable offsets, export scaling, and paper grain passed.');
