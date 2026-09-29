(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const canvas = $('#frostCanvas');
  if (!canvas) return;
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const makeCanvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
  const defaults = () => ({ shape:'circle', width:60, height:52, rotation:-8, cx:.5, cy:.47, feather:5, invert:false,
    blur:20, veil:38, grain:24, tint:'#edeae2', seed:7, preset:'glass', fit:'cover', scale:100, x:0, y:0, background:'#243e36' });
  const state = { ...defaults(), source:null, file:null, url:null, name:'', sourceRevision:0, mask:makeCanvas(1,1), maskHasPixels:false,
    editing:false, tool:'paint', brush:65, movePhoto:false, undo:[], processing:false, hover:false, outputWidth:window.outputFormat.get().shortEdge, palette:window.projectPalette.fallback };
  let operation = 0, request = null, frame = 0, sceneCache = null, dragging = null;
  const toast = text => window.fieldStudyShell.showToast(text);
  const isGeometric = () => state.shape === 'circle' || state.shape === 'rectangle';
  const canExport = () => Boolean(state.source && !state.processing && (isGeometric() || state.maskHasPixels));
  const loadImage = url => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image could not be opened. Try JPG, PNG, or WebP.'));
    image.src = url;
  });
  function status(kind, message) {
    $('#frostStatus').className = 'process-status ' + kind;
    $('#frostStatusText').textContent = message;
  }
  function busy(value, title = 'Finding the subject') {
    state.processing = value;
    $('#frostBusy').hidden = !value;
    $('#frostBusyTitle').textContent = title;
    sync();
  }
  function geometry(w, h) {
    const sw = state.source.naturalWidth || state.source.width, sh = state.source.naturalHeight || state.source.height;
    const factor = (state.fit === 'cover' ? Math.max(w/sw,h/sh) : Math.min(w/sw,h/sh)) * state.scale / 100;
    return { x:(w-sw*factor)/2+state.x*w, y:(h-sh*factor)/2+state.y*h, width:sw*factor, height:sh*factor };
  }
  function opening(w, h) {
    const circle = state.shape === 'circle';
    const width = (circle ? Math.min(w,h) : w) * state.width / 100;
    return { x:state.cx*w, y:state.cy*h, width, height:circle?width:h*state.height/100, angle:circle?0:state.rotation*Math.PI/180 };
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(render); }
  function maskChanged() {
    const data = state.mask.getContext('2d', {willReadFrequently:true}).getImageData(0,0,state.mask.width,state.mask.height).data;
    state.maskHasPixels = false;
    for (let i=3;i<data.length;i+=4) if (data[i]>127) { state.maskHasPixels=true; break; }
    sync(); schedule();
  }
  function rememberMask() {
    state.undo.push(state.mask.getContext('2d').getImageData(0,0,state.mask.width,state.mask.height));
    if (state.undo.length>8) state.undo.shift();
  }
  function applyMask(image) {
    const candidate=makeCanvas(state.mask.width,state.mask.height), ctx=candidate.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(image,0,0,candidate.width,candidate.height);
    const pixels=ctx.getImageData(0,0,candidate.width,candidate.height);
    let area=0;
    for(let i=0;i<pixels.data.length;i+=4) {
      if(pixels.data[i+3]>127) area++;
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;
    }
    if(area<20) throw new Error('No visible subject was selected.');
    rememberMask(); state.mask.getContext('2d').putImageData(pixels,0,0); maskChanged();
  }

  // Cache the expensive blurred photograph; moving an opening only redraws its mask.
  function scene(width, height, logicalWidth, logicalHeight) {
    const key=[state.sourceRevision,width,height,logicalWidth,logicalHeight,state.fit,state.scale,state.x,state.y,state.background,state.blur,state.veil,state.grain,state.tint,state.seed].join(':');
    if(sceneCache?.key===key) return sceneCache;
    const sharp=makeCanvas(width,height), ctx=sharp.getContext('2d',{willReadFrequently:true});
    const unit=width/logicalWidth, g=geometry(logicalWidth,logicalHeight);
    ctx.fillStyle=state.background;ctx.fillRect(0,0,width,height);
    ctx.drawImage(state.source,g.x*unit,g.y*unit,g.width*unit,g.height*unit);
    const pixels=ctx.getImageData(0,0,width,height);
    const frost=makeCanvas(width,height);
    frost.getContext('2d').putImageData(new ImageData(window.FrostEngine.frost(pixels.data,width,height,state,unit),width,height),0,0);
    sceneCache={key,sharp,frost};
    return sceneCache;
  }
  function revealMask(width,height,logicalWidth,logicalHeight,editing=false) {
    const mask=makeCanvas(width,height), ctx=mask.getContext('2d',{willReadFrequently:true}), unit=width/logicalWidth;
    ctx.scale(unit,unit);ctx.fillStyle='#fff';
    if(isGeometric()) {
      const o=opening(logicalWidth,logicalHeight);
      ctx.translate(o.x,o.y);ctx.rotate(o.angle);ctx.beginPath();
      if(state.shape==='circle') ctx.arc(0,0,o.width/2,0,Math.PI*2);
      else ctx.rect(-o.width/2,-o.height/2,o.width,o.height);
      ctx.fill();
    } else {
      const g=geometry(logicalWidth,logicalHeight);
      ctx.drawImage(state.mask,g.x,g.y,g.width,g.height);
    }
    ctx.setTransform(1,0,0,1,0,0);
    if(!editing && (state.feather || state.invert)) {
      const input=ctx.getImageData(0,0,width,height);
      const pixels=window.FrostEngine.blur(input.data,width,height,state.feather*unit);
      if(state.invert) for(let i=3;i<pixels.length;i+=4) pixels[i]=255-pixels[i];
      ctx.putImageData(new ImageData(pixels,width,height),0,0);
    }
    return mask;
  }
  function renderArt(target,width,height,logicalWidth,logicalHeight,editing=false) {
    if(target.width!==width) target.width=width;
    if(target.height!==height) target.height=height;
    const ctx=target.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);
    if(!state.source) {ctx.fillStyle=state.background;ctx.fillRect(0,0,width,height);return;}
    const photo=scene(width,height,logicalWidth,logicalHeight);
    const mask=revealMask(width,height,logicalWidth,logicalHeight,editing), mc=mask.getContext('2d');
    if(editing) {
      ctx.drawImage(photo.sharp,0,0);
      mc.globalCompositeOperation='source-in';mc.fillStyle='#d6ff45';mc.fillRect(0,0,width,height);
      ctx.globalAlpha=.45;ctx.drawImage(mask,0,0);ctx.globalAlpha=1;
    } else {
      ctx.drawImage(photo.frost,0,0);
      // A clear copy of the original is composited through the reveal mask.
      mc.globalCompositeOperation='source-in';mc.drawImage(photo.sharp,0,0);
      ctx.drawImage(mask,0,0);
    }
  }
  function drawHandles() {
    const overlay=$('#frostHandles');overlay.width=canvas.width;overlay.height=canvas.height;
    if(!state.source || !isGeometric() || state.movePhoto || state.editing || !(state.hover || document.activeElement===canvas)) return;
    const logical=window.outputFormat.logicalDimensions(), ctx=overlay.getContext('2d'), o=opening(logical.width,logical.height);
    const cssScale=logical.width / Math.max(1,canvas.getBoundingClientRect().width);
    ctx.scale(canvas.width/logical.width,canvas.height/logical.height);ctx.translate(o.x,o.y);ctx.rotate(o.angle);
    ctx.beginPath();
    if(state.shape==='circle') ctx.arc(0,0,o.width/2,0,Math.PI*2);
    else ctx.rect(-o.width/2,-o.height/2,o.width,o.height);
    ctx.strokeStyle='#17191466';ctx.lineWidth=3*cssScale;ctx.stroke();
    ctx.strokeStyle='#fff';ctx.lineWidth=cssScale;ctx.setLineDash([5*cssScale,5*cssScale]);ctx.stroke();ctx.setLineDash([]);
    const handle=state.shape==='circle'?{x:o.width/2/Math.SQRT2,y:o.height/2/Math.SQRT2}:{x:o.width/2,y:o.height/2};
    ctx.fillStyle='#fff';ctx.strokeStyle='#171914';ctx.lineWidth=cssScale;
    ctx.fillRect(handle.x-5*cssScale,handle.y-5*cssScale,10*cssScale,10*cssScale);
    ctx.strokeRect(handle.x-5*cssScale,handle.y-5*cssScale,10*cssScale,10*cssScale);
  }
  function render() {
    frame=0;const logical=window.outputFormat.logicalDimensions();
    const scale=Math.min(1,1000/Math.max(logical.width,logical.height));
    renderArt(canvas,Math.round(logical.width*scale),Math.round(logical.height*scale),logical.width,logical.height,state.editing);
    window.outputFormat.applyShell($('#frostArtboardShell'));
    const output=window.outputFormat.dimensions(state.outputWidth);
    $('#frostDimensions').textContent=`${output.width} × ${output.height} PX`;
    drawHandles();
  }
  function updateHeader() {
    if(document.body.dataset.activeTool==='frost') $('#fileNameHeader').textContent=state.name?state.name.replace(/\.[^.]+$/,'').toUpperCase():'FROSTED REVEAL';
  }
  function sync() {
    const rows=[['Width','width','%'],['Height','height','%'],['Rotation','rotation','°'],['Feather','feather',' px'],['Blur','blur',' px'],['Veil','veil','%'],['Grain','grain','%'],['Scale','scale','%'],['Brush','brush',' px']];
    rows.forEach(([id,key,unit])=>{$('#frost'+id).value=state[key];$('#frost'+id+'Output').textContent=state[key]+unit;});
    ['Tint','Background'].forEach(id=>{const value=state[id.toLowerCase()];$('#frost'+id).value=value;$('#frost'+id+'Output').textContent=value.toUpperCase();});
    $('#frostInvert').checked=state.invert;$('#frostFit').value=state.fit;
    $('#frostShapeControls').hidden=!isGeometric();$('#frostRectangleControls').hidden=state.shape!=='rectangle';
    $('#frostSelectionActions').hidden=isGeometric();$('#frostMaskControls').hidden=!state.editing;
    $('#frostRefine').textContent=state.editing?'Preview reveal':'Refine reveal';
    $('#frostMovePhoto').textContent=state.movePhoto?'Done moving photograph':'Move photograph';
    $('#frostMovePhoto').setAttribute('aria-pressed',String(state.movePhoto));
    for(const id of ['Auto','Refine','Clear','Done','MovePhoto','CenterPhoto']) $('#frost'+id).disabled=!state.source||state.processing;
    $('#frostUndo').disabled=!state.undo.length||state.processing;
    canvas.dataset.editing=String(state.editing);
    $('#frostModeLabel').textContent=state.editing?'EDITING CLEAR AREA':state.movePhoto?'MOVING PHOTOGRAPH':'FROSTED REVEAL';
    $('#frostHelp').textContent=state.editing?'Green stays clear · pick an object or paint an opening.':state.movePhoto?'Drag the photograph · arrow keys nudge.':isGeometric()?'Drag the opening · drag its handle to resize · arrow keys nudge.':'Refine reveal to edit the clear area · use Photo framing to move the image.';
    for(const [attr,key] of [['shape','shape'],['preset','preset'],['tool','tool']]) document.querySelectorAll(`[data-frost-${attr}]`).forEach(button=>{
      const selected=button.dataset['frost'+attr[0].toUpperCase()+attr.slice(1)]===state[key];
      button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
      button.disabled=state.processing;
    });
    window.projectPalette.render($('#frostPalette'),state.palette,color=>{state.tint=color;state.preset='';sync();schedule();},state.tint);
  }
  function edit(value) {
    if(!state.source||state.processing) return;
    state.editing=value;state.movePhoto=false;
    if(!value) status(state.maskHasPixels?'ready':'error',state.maskHasPixels?'Clear area ready · adjust the frost surface.':'No clear area yet. Refine reveal to pick an object or paint one.');
    sync();schedule();
  }
  async function automatic() {
    if(!state.file||state.processing) return;
    const id=++operation;request?.abort();request=new AbortController();
    busy(true);status('working','Finding the subject locally…');
    try {
      const response=await fetch('/api/segment',{method:'POST',headers:{'Content-Type':state.file.type},body:state.file,signal:request.signal});
      if(!response.ok) throw new Error('Automatic selection unavailable.');
      const url=URL.createObjectURL(await response.blob());
      try {
        const image=await loadImage(url);if(id!==operation) return;
        applyMask(image);state.shape='subject';state.editing=false;state.movePhoto=false;status('ready','Subject revealed · use Refine reveal for touch-ups.');
      } finally {URL.revokeObjectURL(url);}
    } catch(error) {
      if(id!==operation||error.name==='AbortError') return;
      state.editing=true;state.tool='point';status('error','Auto-selection missed this image. Pick an object on the canvas, or paint the reveal.');
    } finally {if(id===operation){busy(false);schedule();}}
  }
  async function pick(point) {
    const id=++operation;busy(true,'Selecting this object');status('working','Selecting the object you clicked…');
    try {
      const extractor=await import('/point-extractor.js');
      const image=await extractor.extract(state.source,point);if(id!==operation)return;
      applyMask(image);state.editing=false;status('ready','Object revealed · refine its edges or adjust the frost.');
    } catch(error) {
      if(id===operation){state.tool='paint';state.editing=true;status('error','Could not select that object. Use Add brush to paint the clear area.');}
    } finally {if(id===operation){busy(false);schedule();}}
  }
  async function setShape(shape) {
    if(state.processing)return;
    state.shape=shape;state.movePhoto=false;state.editing=false;
    if(shape==='brush' && state.source){state.tool='paint';state.editing=true;}
    sync();schedule();
    if(shape==='subject' && state.source && !state.maskHasPixels) await automatic();
  }
  function commitSource(source,file,url,name) {
    if(state.url)URL.revokeObjectURL(state.url);
    Object.assign(state,{source,file,url,name,sourceRevision:state.sourceRevision+1,undo:[],maskHasPixels:false,editing:false,movePhoto:false,x:0,y:0,scale:100,cx:.5,cy:.47});
    const factor=Math.min(1,1400/Math.max(source.naturalWidth,source.naturalHeight));
    state.mask.width=Math.max(1,Math.round(source.naturalWidth*factor));state.mask.height=Math.max(1,Math.round(source.naturalHeight*factor));
    sceneCache=null;state.palette=window.projectPalette.extract(source,8);
    $('#frostSourceThumb').src=url;$('#frostSourceName').textContent=name;$('#frostSourceMeta').textContent=`${source.naturalWidth} × ${source.naturalHeight} · local`;
    $('#frostSourcePreview').hidden=false;$('#frostDropIdle').hidden=true;$('#frostEmpty').hidden=true;updateHeader();
  }
  async function loadFile(file) {
    if(!file)return;
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type)){toast('Choose a JPG, PNG, or WebP image.');return;}
    if(file.size>30*1024*1024){toast('Choose an image smaller than 30 MB.');return;}
    const id=++operation;request?.abort();const url=URL.createObjectURL(file);busy(true,'Opening your photograph');
    try {
      const source=await loadImage(url);if(id!==operation){URL.revokeObjectURL(url);return;}
      if(source.naturalWidth*source.naturalHeight>48e6)throw new Error('Resize this image below 48 megapixels before opening it.');
      commitSource(source,file,url,file.name);
      const probe=makeCanvas(100,100),pc=probe.getContext('2d',{willReadFrequently:true});pc.drawImage(source,0,0,100,100);
      const pixels=pc.getImageData(0,0,100,100).data;let transparent=0,opaque=0;
      for(let i=3;i<pixels.length;i+=4){if(pixels[i]<25)transparent++;if(pixels[i]>127)opaque++;}
      if(transparent>30&&opaque>20) {
        try { applyMask(source); }
        catch (_) { /* A tiny alpha region can still be used with a geometric opening. */ }
      }
      busy(false);status('ready','Photograph ready · choose a clear opening and adjust the frost.');
      if(state.shape==='subject'&&!state.maskHasPixels)await automatic();
      else if(state.shape==='brush'){state.editing=true;state.tool='paint';sync();}
      schedule();
    } catch(error) {
      if(id===operation){URL.revokeObjectURL(url);busy(false);status('error',error.message);toast(error.message);}
    }
  }
  async function demo() {
    if(state.processing)return;
    const id=++operation;request?.abort();busy(true,'Opening the botanical sample');
    try {
      const subject=await loadImage('/frost-sample.svg');if(id!==operation)return;
      const photo=makeCanvas(900,1200),ctx=photo.getContext('2d');
      const background=ctx.createLinearGradient(0,0,900,1200);background.addColorStop(0,'#acbca4');background.addColorStop(1,'#69867a');
      ctx.fillStyle=background;ctx.fillRect(0,0,900,1200);ctx.fillStyle='#809281';ctx.fillRect(0,1025,900,175);
      ctx.fillStyle='#294d3925';ctx.beginPath();ctx.ellipse(451,1062,135,25,0,0,Math.PI*2);ctx.fill();ctx.drawImage(subject,0,0);
      const blob=await new Promise(resolve=>photo.toBlob(resolve));if(id!==operation)return;
      const url=URL.createObjectURL(blob),source=await loadImage(url);if(id!==operation){URL.revokeObjectURL(url);return;}
      Object.assign(state,defaults());commitSource(source,new File([blob],'botanical-sample.png',{type:'image/png'}),url,'botanical-sample.png');
      applyMask(subject);state.undo=[];
      $('#frostSourceName').textContent='Botanical sample';$('#frostSourceMeta').textContent='Illustrated demo · replace with your photograph';
      status('ready','Sample ready · move the opening, or try a subject reveal.');
    } catch(error){if(id===operation)status('error','The sample could not be opened. Please choose an image.');}
    finally{if(id===operation){busy(false);schedule();}}
  }

  function pointer(event) {
    const r=canvas.getBoundingClientRect(),l=window.outputFormat.logicalDimensions(),g=geometry(l.width,l.height);
    const x=(event.clientX-r.left)/r.width*l.width,y=(event.clientY-r.top)/r.height*l.height;
    return {x,y,sx:(x-g.x)/g.width,sy:(y-g.y)/g.height,g,l,hit:14*l.width/r.width};
  }
  function paint(p,last) {
    const ctx=state.mask.getContext('2d');ctx.save();ctx.globalCompositeOperation=state.tool==='erase'?'destination-out':'source-over';
    ctx.strokeStyle='#fff';ctx.fillStyle='#fff';ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=state.brush/p.g.width*state.mask.width;
    const x=p.sx*state.mask.width,y=p.sy*state.mask.height;
    ctx.beginPath();
    if(last){ctx.moveTo(last.sx*state.mask.width,last.sy*state.mask.height);ctx.lineTo(x,y);ctx.stroke();}
    else{ctx.arc(x,y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}
    ctx.restore();schedule();
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!state.source||state.processing||event.button!==0)return;
    const p=pointer(event);canvas.focus();
    if(state.editing&&state.tool==='point'){if(p.sx>=0&&p.sx<=1&&p.sy>=0&&p.sy<=1)pick({x:p.sx,y:p.sy});return;}
    if(!state.editing&&!state.movePhoto&&!isGeometric())return;
    event.preventDefault();canvas.setPointerCapture(event.pointerId);
    let mode=state.editing?'paint':state.movePhoto?'photo':'opening';
    if(mode==='opening') {
      const o=opening(p.l.width,p.l.height),hx=state.shape==='circle'?o.width/2/Math.SQRT2:o.width/2,hy=state.shape==='circle'?o.height/2/Math.SQRT2:o.height/2;
      const dx=p.x-(o.x+hx*Math.cos(o.angle)-hy*Math.sin(o.angle)),dy=p.y-(o.y+hx*Math.sin(o.angle)+hy*Math.cos(o.angle));
      if(Math.hypot(dx,dy)<p.hit)mode='resize';
    }
    dragging={id:event.pointerId,mode,p};
    if(mode==='paint'){rememberMask();paint(p,null);}
  });
  canvas.addEventListener('pointermove',event=>{
    if(!dragging||dragging.id!==event.pointerId)return;
    const p=pointer(event);
    if(dragging.mode==='paint')paint(p,dragging.p);
    else if(dragging.mode==='photo'){
      state.x=clamp(state.x+(p.x-dragging.p.x)/p.l.width,-1,1);state.y=clamp(state.y+(p.y-dragging.p.y)/p.l.height,-1,1);
    } else if(dragging.mode==='opening'){
      state.cx=clamp(state.cx+(p.x-dragging.p.x)/p.l.width,0,1);state.cy=clamp(state.cy+(p.y-dragging.p.y)/p.l.height,0,1);
    } else {
      const o=opening(p.l.width,p.l.height),dx=p.x-o.x,dy=p.y-o.y;
      if(state.shape==='circle')state.width=Math.round(clamp(Math.hypot(dx,dy)*200/Math.min(p.l.width,p.l.height),10,100));
      else {
        state.width=Math.round(clamp(Math.abs(dx*Math.cos(o.angle)+dy*Math.sin(o.angle))*200/p.l.width,10,100));
        state.height=Math.round(clamp(Math.abs(-dx*Math.sin(o.angle)+dy*Math.cos(o.angle))*200/p.l.height,10,100));
      }
      sync();
    }
    dragging.p=p;schedule();
  });
  function endDrag(event) {
    if(!dragging||event.pointerId!==dragging.id)return;
    const mode=dragging.mode;dragging=null;
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    if(mode==='paint'){maskChanged();status('ready','Clear area updated · choose Done to preview.');}
  }
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,endDrag);
  canvas.addEventListener('pointerenter',()=>{state.hover=true;drawHandles();});
  canvas.addEventListener('pointerleave',()=>{state.hover=false;drawHandles();});
  canvas.addEventListener('focus',drawHandles);canvas.addEventListener('blur',drawHandles);
  canvas.addEventListener('keydown',event=>{
    if(!state.source||state.processing)return;
    if(event.key==='Escape'){if(state.editing)edit(false);state.movePhoto=false;sync();schedule();return;}
    if(state.editing){if(event.key==='Enter'&&state.tool==='point'){event.preventDefault();pick({x:.5,y:.5});}return;}
    if(!isGeometric()&&!state.movePhoto)return;
    const l=window.outputFormat.logicalDimensions(),step=event.shiftKey?10:1;
    const x=state.movePhoto?'x':'cx',y=state.movePhoto?'y':'cy',low=state.movePhoto?-1:0;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
      event.preventDefault();
      if(event.key==='ArrowLeft')state[x]-=step/l.width;if(event.key==='ArrowRight')state[x]+=step/l.width;
      if(event.key==='ArrowUp')state[y]-=step/l.height;if(event.key==='ArrowDown')state[y]+=step/l.height;
      state[x]=clamp(state[x],low,1);state[y]=clamp(state[y],low,1);schedule();
    } else if(!state.movePhoto&&['+','=','-'].includes(event.key)){
      event.preventDefault();state.width=clamp(state.width+(event.key==='-'?-2:2),10,100);sync();schedule();
    }
  });

  function preset(name) {
    const presets={glass:{blur:20,veil:38,grain:24,tint:'#edeae2',feather:5},paper:{blur:9,veil:65,grain:48,tint:'#f3ead5',feather:0},mist:{blur:38,veil:20,grain:12,tint:'#dbe5df',feather:26}};
    Object.assign(state,presets[name],{preset:name});sync();schedule();
  }
  function reset() {
    operation++;request?.abort();request=null;
    Object.assign(state,defaults(),{editing:false,movePhoto:false});sceneCache=null;busy(false);schedule();
    status(state.source?'ready':'',state.source?'Frost settings reset · your photograph is ready.':'Add a photograph or try the botanical sample.');
    toast('Frost settings reset. Your photograph and painted selection are kept.');
  }
  function exportImage(type) {
    if(!canExport()){toast('Add a photograph and choose a clear area before exporting.');return;}
    const l=type==='jpeg'?{width:900,height:900}:window.outputFormat.logicalDimensions();
    const size=type==='jpeg'?{width:3000,height:3000}:window.outputFormat.dimensions(state.outputWidth),target=makeCanvas(size.width,size.height);
    try {
      renderArt(target,size.width,size.height,l.width,l.height,false);
      const filename=(state.name||'frosted-reveal').replace(/\.[^.]+$/,'').replace(/[^a-z0-9-]/gi,'-')+`-frost-${size.width}x${size.height}.${type==='jpeg'?'jpg':'png'}`;
      const form=document.createElement('form');form.method='POST';form.action='/api/export';form.target='fieldStudyDownload';form.hidden=true;
      for(const [name,value] of [['image',target.toDataURL('image/'+type,.94)],['filename',filename]]){
        const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);
      }
      document.body.append(form);form.submit();requestAnimationFrame(()=>form.remove());toast(`${type==='jpeg'?'JPEG':'PNG'} exported · ${size.width} × ${size.height}`);
    } catch(error){toast('The image could not be exported. Try the standard PNG size.');}
    finally{sceneCache=null;schedule();}
  }
  $('#frostSourceInput').addEventListener('change',event=>{loadFile(event.target.files[0]);event.target.value='';});
  $('#frostEmptyChoose').addEventListener('click',()=>$('#frostSourceInput').click());
  for(const id of ['frostDemo','frostEmptyDemo'])$('#'+id).addEventListener('click',demo);
  const drop=$('#frostDropZone');
  for(const type of ['dragenter','dragover'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.add('dragover');});
  for(const type of ['dragleave','drop'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove('dragover');if(type==='drop')loadFile(event.dataTransfer.files[0]);});
  document.querySelectorAll('[data-frost-shape]').forEach(b=>b.addEventListener('click',()=>setShape(b.dataset.frostShape)));
  document.querySelectorAll('[data-frost-preset]').forEach(b=>b.addEventListener('click',()=>preset(b.dataset.frostPreset)));
  document.querySelectorAll('[data-frost-tool]').forEach(b=>b.addEventListener('click',()=>{state.tool=b.dataset.frostTool;sync();}));
  for(const [id,key] of [['Width','width'],['Height','height'],['Rotation','rotation'],['Feather','feather'],['Blur','blur'],['Veil','veil'],['Grain','grain'],['Scale','scale'],['Brush','brush']]) {
    $('#frost'+id).addEventListener('input',event=>{state[key]=Number(event.target.value);if(['blur','veil','grain','feather'].includes(key))state.preset='';sync();schedule();});
  }
  for(const id of ['Tint','Background'])$('#frost'+id).addEventListener('input',event=>{state[id.toLowerCase()]=event.target.value;state.preset='';sync();schedule();});
  $('#frostInvert').addEventListener('change',event=>{state.invert=event.target.checked;schedule();});
  $('#frostFit').addEventListener('change',event=>{state.fit=event.target.value;schedule();});
  $('#frostCenterWindow').addEventListener('click',()=>{state.cx=state.cy=.5;schedule();});
  $('#frostReroll').addEventListener('click',()=>{state.seed++;schedule();});
  $('#frostAuto').addEventListener('click',automatic);
  $('#frostRefine').addEventListener('click',()=>edit(!state.editing));$('#frostDone').addEventListener('click',()=>edit(false));
  $('#frostUndo').addEventListener('click',()=>{if(state.processing)return;const last=state.undo.pop();if(last){state.mask.getContext('2d').putImageData(last,0,0);maskChanged();}});
  $('#frostClear').addEventListener('click',()=>{if(state.processing)return;rememberMask();state.mask.getContext('2d').clearRect(0,0,state.mask.width,state.mask.height);state.tool='paint';maskChanged();status('ready','Reveal cleared · paint a new clear area.');});
  $('#frostMovePhoto').addEventListener('click',()=>{state.movePhoto=!state.movePhoto;state.editing=false;sync();schedule();});
  $('#frostCenterPhoto').addEventListener('click',()=>{state.x=state.y=0;state.scale=100;sync();schedule();});
  window.frostedReveal={activate(){updateHeader();sync();schedule();},refreshFormat(){sceneCache=null;schedule();},reset,
    hasContent:()=>Boolean(state.source),getExportOptions:()=>({canExport:canExport(),motionAvailable:false,outputWidth:state.outputWidth}),
    setOutputWidth(width){state.outputWidth=[900,1350,3000].includes(Number(width))?Number(width):900;schedule();},exportPng:()=>exportImage('png'),exportJpeg:()=>exportImage('jpeg')};
  sync();render();
})();
