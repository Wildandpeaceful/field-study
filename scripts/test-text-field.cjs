const assert=require('node:assert/strict');
const E=require('../public/text-field-engine.js');
const base={width:900,height:1200,text:'one two three four five six seven eight nine ten',unit:'word',repeat:true,columns:8,size:22,rowGap:205,density:87,jitter:78,margin:4,seed:29,clear:false,offsets:{}};
const measure=(text,size)=>Array.from(text).length*size*.55;
const render=o=>E.layout({...base,...o},measure);
const a=render({}),b=render({});assert.deepEqual(a,b,'layout and rerenders are deterministic');
assert.notDeepEqual(a.items,render({seed:30}).items,'spacing rerolls change the layout');
assert.equal(render({text:'  \n \t'}).items.length,0,'empty content has no placements');
assert.deepEqual(E.tokens('line one\n\nline two','line'),['line one','line two']);
const once=render({repeat:false});assert.equal(once.items.length,10);assert.deepEqual(once.items.map(i=>i.text),E.tokens(base.text),'non-repeating copy is in reading order');
for(const o of [{},{width:1600,height:900},{width:900,height:1600},{columns:14,size:48},{columns:2,size:12,rowGap:140}]){
 const s={...base,...o},result=render(o),m=Math.min(s.width,s.height)*s.margin/100;
 for(const i of result.items){assert(i.x>=m-.001&&i.y>=m-.001);assert(i.x+i.width<=s.width-m+.001&&i.y+i.height<=s.height-m+.001);}
 for(let i=0;i<result.items.length;i++)for(let j=i+1;j<result.items.length;j++){const x=result.items[i],y=result.items[j];assert(!(x.x<y.x+y.width&&x.x+x.width>y.x&&x.y<y.y+y.height&&x.y+x.height>y.y),'generated words do not overlap');}
}
const clear=render({clear:true,clearX:.5,clearY:.35,clearWidth:32,clearHeight:28});
assert(clear.items.length<a.items.length);for(const b of clear.items)assert(!E.intersectsEllipse(b,{enabled:true,x:450,y:420,rx:144,ry:168}));
assert.deepEqual(clear.items.slice(0,10).map(i=>i.text),E.tokens(base.text),'clear area does not skip source words');
const doubled=render({width:1800,height:2400});assert.equal(doubled.items.length,a.items.length);a.items.forEach((b,i)=>{for(const k of ['x','y','width','height','size'])assert(Math.abs(doubled.items[i][k]-b[k]*2)<1e-7,'layout scales exactly for export');});
assert.equal(E.contrastColor(255,255,255),'#171914');assert.equal(E.contrastColor(0,0,0),'#ffffff');
const fit=E.fittedRect(2000,1000,900,1200);assert.equal(fit.height,1200);assert.equal(fit.width,2400);
console.log('Text Field: stable spacing, reading order, empty text, bounds, collision avoidance, clear area, export scaling, contrast, and framing passed.');
