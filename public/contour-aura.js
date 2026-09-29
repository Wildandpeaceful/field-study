(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const canvas = $('#auraCanvas');
  if (!canvas) return;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const defaults = () => ({ count:4, spacing:26, thickness:10, gap:12, roughness:65, colors:['#fffbed','#d6ff45','#4b69ff'], multicolor:false, background:'#213d35', backdrop:'photo', fit:'contain', scale:100, dim:0, x:0, y:0, seed:7, preset:'chalk' });
  const state = { ...defaults(), source:null, file:null, url:null, name:'', mask:document.createElement('canvas'), cutout:null, revision:0, editing:false, mode:'point', brush:40, undo:[], processing:false, outputWidth:window.outputFormat.get().shortEdge, palette:window.projectPalette.fallback, sourceEpoch:0 };
  let operation = 0, request = null, pendingFrame = 0, cache = null, dragging = null;
  const ringLayer = document.createElement('canvas');
  const showToast = message => window.fieldStudyShell.showToast(message);
  function status(kind, text) {
    $('#auraStatus').className = 'process-status ' + kind;
    $('#auraStatusText').textContent = text;
  }
  function busy(value, title='Finding the subject') {
    state.processing = value;
    $('#auraBusy').hidden = !value;
    $('#auraBusyTitle').textContent = title;
    sync();
  }
  const loadImage = url => new Promise((resolve,reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('This image could not be opened. Try JPG, PNG, or WebP.')); image.src = url;
  });
  function sourceSize() { return { width:state.source.naturalWidth || state.source.width, height:state.source.naturalHeight || state.source.height }; }
  function geometry(w,h) {
    const s = sourceSize();
    const fit = state.fit === 'cover' ? Math.max(w/s.width,h/s.height) : Math.min(w/s.width,h/s.height);
    const scale = fit * state.scale / 100;
    return { x:(w-s.width*scale)/2+state.x*w, y:(h-s.height*scale)/2+state.y*h, width:s.width*scale, height:s.height*scale };
  }
  function maskChanged() {
    state.revision++; cache = null;
    const c = document.createElement('canvas'); c.width = state.mask.width; c.height = state.mask.height;
    const ctx = c.getContext('2d'); ctx.drawImage(state.source,0,0,c.width,c.height); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(state.mask,0,0);
    state.cutout = c;
    schedule(); sync();
  }
  function applyMask(image) {
    // Validate on a temporary canvas so failed extraction preserves the current selection.
    const candidate = document.createElement('canvas');
    candidate.width = state.mask.width; candidate.height = state.mask.height;
    const ctx = candidate.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(image,0,0,candidate.width,candidate.height);
    const pixels = ctx.getImageData(0,0,state.mask.width,state.mask.height);
    let area = 0;
    for(let i=0;i<pixels.data.length;i+=4) { if(pixels.data[i+3]>127) area++; pixels.data[i]=255; pixels.data[i+1]=255; pixels.data[i+2]=255; }
    if(area < 20) throw new Error('No visible subject was selected.');
    state.mask.getContext('2d').putImageData(pixels,0,0); maskChanged();
  }
  function rememberMask() {
    state.undo.push(state.mask.getContext('2d').getImageData(0,0,state.mask.width,state.mask.height));
    if(state.undo.length>8) state.undo.shift();
  }
  function fieldFor(w,h) {
    const g = geometry(w,h), factor = Math.min(1,1100/Math.max(w,h));
    const fw = Math.round(w*factor), fh = Math.round(h*factor);
    const key = [state.revision,w,h,state.fit,state.scale,state.x,state.y].join(':');
    if(cache?.key === key) return cache.field;
    const mask = document.createElement('canvas'); mask.width=fw; mask.height=fh;
    const ctx=mask.getContext('2d',{willReadFrequently:true}); ctx.drawImage(state.mask,g.x*factor,g.y*factor,g.width*factor,g.height*factor);
    const rgba = ctx.getImageData(0,0,fw,fh).data, alpha=new Uint8Array(fw*fh);
    for(let i=0;i<alpha.length;i++) alpha[i]=rgba[i*4+3];
    const field=window.AuraEngine.distanceField(alpha,fw,fh); cache={key,field};
    return field;
  }
  function renderArt(target, width, height, logicalWidth, logicalHeight, selection=false) {
    if(target.width!==width) target.width=width;
    if(target.height!==height) target.height=height;
    const ctx=target.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,width,height);
    const unit=width/logicalWidth; ctx.scale(unit,unit);
    ctx.fillStyle=state.background; ctx.fillRect(0,0,logicalWidth,logicalHeight);
    if(!state.source) return;
    const g=geometry(logicalWidth,logicalHeight);
    if(selection || state.backdrop==='photo') {
      ctx.drawImage(state.source,g.x,g.y,g.width,g.height);
      if(!selection && state.dim) { ctx.fillStyle=`rgba(0,0,0,${state.dim/100})`; ctx.fillRect(0,0,logicalWidth,logicalHeight); }
    }
    if(selection) {
      const tint=document.createElement('canvas'); tint.width=state.mask.width; tint.height=state.mask.height;
      const tc=tint.getContext('2d'); tc.drawImage(state.mask,0,0); tc.globalCompositeOperation='source-in'; tc.fillStyle='#d6ff45'; tc.fillRect(0,0,tint.width,tint.height);
      ctx.globalAlpha=.48; ctx.drawImage(tint,g.x,g.y,g.width,g.height); ctx.globalAlpha=1;
    } else if(state.cutout) {
      const pixels=window.AuraEngine.render(fieldFor(logicalWidth,logicalHeight),width,height,state,logicalWidth);
      ringLayer.width=width; ringLayer.height=height;
      ringLayer.getContext('2d').putImageData(new ImageData(pixels,width,height),0,0);
      ctx.drawImage(ringLayer,0,0,logicalWidth,logicalHeight);
      ctx.drawImage(state.cutout,g.x,g.y,g.width,g.height);
    }
    ctx.setTransform(1,0,0,1,0,0);
  }
  function render() {
    pendingFrame=0;
    const logical=window.outputFormat.logicalDimensions();
    // Exports render separately at their full requested resolution.
    const displayScale=Math.min(1,1100/Math.max(logical.width,logical.height));
    renderArt(canvas,Math.round(logical.width*displayScale),Math.round(logical.height*displayScale),logical.width,logical.height,state.editing);
    window.outputFormat.applyShell($('#auraArtboardShell'));
    const output=window.outputFormat.dimensions(state.outputWidth);
    $('#auraDimensions').textContent=`${output.width} × ${output.height} PX`;
  }
  function schedule() { if(!pendingFrame) pendingFrame=requestAnimationFrame(render); }
  function updateHeader() { if(document.body.dataset.activeTool==='aura') $('#fileNameHeader').textContent=state.name ? state.name.replace(/\.[^.]+$/,'').toUpperCase() : 'CONTOUR AURA'; }
  function sync() {
    [['Count','count',''],['Spacing','spacing',' px'],['Thickness','thickness',' px'],['Gap','gap',' px'],['Roughness','roughness','%'],['Scale','scale','%'],['Dim','dim','%'],['Brush','brush',' px']].forEach(([id,key,unit])=>{ $('#aura'+id).value=state[key]; $('#aura'+id+'Output').textContent=state[key]+unit; });
    ['Color1','Color2','Color3','Background'].forEach((id,i)=>{const value=i<3?state.colors[i]:state.background; $('#aura'+id).value=value; $('#aura'+id+'Output').textContent=value.toUpperCase();});
    $('#auraMulticolor').checked=state.multicolor; $('#auraExtraColors').hidden=!state.multicolor;
    $('#auraBackdrop').value=state.backdrop; $('#auraFit').value=state.fit;
    $('#auraMaskControls').hidden=!state.editing;
    $('#auraRefine').textContent=state.editing?'Preview aura':'Refine selection';
    for(const id of ['auraAuto','auraRefine']) $('#'+id).disabled=!state.source || state.processing;
    $('#auraUndo').disabled=!state.undo.length || state.processing;
    $('#auraClearMask').disabled=state.processing;
    $('#auraModeLabel').textContent=state.editing?'EDITING SUBJECT MASK':'PAINTED OUTLINES';
    $('#auraHelp').textContent=state.editing?'Green is selected. Pick an object, or use Add brush and Erase.':'Drag to reframe · use Refine selection to correct the subject.';
    canvas.dataset.editing=String(state.editing);
    document.querySelectorAll('[data-aura-mode]').forEach(b=>{const on=b.dataset.auraMode===state.mode;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});
    document.querySelectorAll('[data-aura-preset]').forEach(b=>{const on=b.dataset.auraPreset===state.preset;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});
    window.projectPalette.render($('#auraPalette'),state.palette,color=>{state.colors[0]=color;state.preset='';sync();schedule();},state.colors[0]);
  }
  function edit(value) {
    if(!state.source||state.processing) return;
    state.editing=value;
    if(!value) status('ready',hasMask() ? 'Selection ready · adjust the painted outlines.' : 'No subject selected · use Refine selection to add one.');
    sync();schedule();
  }
  async function automatic() {
    if(!state.file || state.processing) return;
    const id=++operation; request?.abort(); request=new AbortController();
    busy(true); status('working','Finding the foreground locally…');
    try {
      const response=await fetch('/api/segment',{method:'POST',headers:{'Content-Type':state.file.type},body:state.file,signal:request.signal});
      if(!response.ok) throw new Error('Automatic selection unavailable.');
      const url=URL.createObjectURL(await response.blob());
      try { const image=await loadImage(url); if(id!==operation) return; rememberMask();applyMask(image);state.editing=false;status('ready','Subject selected · adjust the painted outlines.'); }
      finally {URL.revokeObjectURL(url);}
    } catch(error) {
      if(id!==operation || error.name==='AbortError') return;
      state.editing=true;state.mode='point';status('error','Auto-selection missed this image. Pick an object on the canvas, or use Add brush.');
    } finally { if(id===operation){busy(false);schedule();} }
  }
  async function loadFile(file) {
    if(!file) return;
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type)) {showToast('Choose a JPG, PNG, or WebP image.');return;}
    if(file.size>30*1024*1024) {showToast('Choose an image smaller than 30 MB.');return;}
    const id=++operation;request?.abort(); const url=URL.createObjectURL(file);
    busy(true,'Opening your image');
    try {
      const source=await loadImage(url);
      if(id!==operation){URL.revokeObjectURL(url);return;}
      if(source.naturalWidth*source.naturalHeight>48e6) throw new Error('This image is too large to edit smoothly. Resize it below 48 megapixels.');
      if(state.url) URL.revokeObjectURL(state.url);
      state.source=source;state.file=file;state.url=url;state.name=file.name;state.sourceEpoch++;state.undo=[];state.cutout=null;state.editing=false;
      state.x=0;state.y=0;state.scale=100;
      const factor=Math.min(1,1400/Math.max(source.naturalWidth,source.naturalHeight));
      state.mask.width=Math.round(source.naturalWidth*factor);state.mask.height=Math.round(source.naturalHeight*factor);state.revision++;cache=null;
      $('#auraSourceThumb').src=url;$('#auraSourceName').textContent=file.name;$('#auraSourceMeta').textContent=`${source.naturalWidth} × ${source.naturalHeight} · local`;
      $('#auraSourcePreview').hidden=false;$('#auraDropIdle').hidden=true;$('#auraEmpty').hidden=true;
      state.palette=window.projectPalette.extract(source,8);updateHeader();
      const probe=document.createElement('canvas');probe.width=100;probe.height=100;const pc=probe.getContext('2d',{willReadFrequently:true});pc.drawImage(source,0,0,100,100);const rgba=pc.getImageData(0,0,100,100).data;
      let transparent=0,opaque=0;for(let i=3;i<rgba.length;i+=4){if(rgba[i]<25)transparent++;if(rgba[i]>127)opaque++;}
      busy(false);
      if(transparent>30 && opaque>20){applyMask(source);status('ready','Using the image’s transparent cutout · no extraction needed.');}
      else await automatic();
      schedule();
    } catch(error) { if(id===operation){URL.revokeObjectURL(url);busy(false);status('error',error.message);showToast(error.message);} }
  }
  async function pick(point) {
    const id=++operation,epoch=state.sourceEpoch;busy(true,'Selecting this object');status('working','Selecting the object you clicked…');
    try {
      const extractor=await import('/point-extractor.js');
      const selected=await extractor.extract(state.source,point);
      if(id!==operation||epoch!==state.sourceEpoch)return;
      rememberMask();applyMask(selected);state.editing=false;status('ready','Object selected · use Refine selection for touch-ups.');
    } catch(error) {if(id===operation){state.editing=true;state.mode='paint';status('error','Could not select that object. Paint over the subject with Add brush.');}}
    finally {if(id===operation){busy(false);schedule();}}
  }
  function sourcePoint(event) {
    const rect=canvas.getBoundingClientRect(),logical=window.outputFormat.logicalDimensions(),g=geometry(logical.width,logical.height);
    const x=(event.clientX-rect.left)/rect.width*logical.width, y=(event.clientY-rect.top)/rect.height*logical.height;
    return {x:(x-g.x)/g.width,y:(y-g.y)/g.height,logicalX:x,logicalY:y,g};
  }
  function brush(point,last) {
    const ctx=state.mask.getContext('2d');ctx.save();ctx.globalCompositeOperation=state.mode==='erase'?'destination-out':'source-over';ctx.strokeStyle='#fff';ctx.fillStyle='#fff';ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=state.brush/point.g.width*state.mask.width;
    const x=point.x*state.mask.width,y=point.y*state.mask.height;
    if(last){ctx.beginPath();ctx.moveTo(last.x*state.mask.width,last.y*state.mask.height);ctx.lineTo(x,y);ctx.stroke();}
    else {ctx.beginPath();ctx.arc(x,y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}
    ctx.restore();state.revision++;cache=null;schedule();
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!state.source||state.processing||event.button!==0)return;
    const p=sourcePoint(event);canvas.focus();
    if(state.editing && state.mode==='point'){if(p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)pick(p);return;}
    event.preventDefault();canvas.setPointerCapture(event.pointerId);
    dragging={id:event.pointerId,p,edit:state.editing};
    if(state.editing){rememberMask();brush(p,null);}
  });
  canvas.addEventListener('pointermove',event=>{
    if(!dragging||event.pointerId!==dragging.id)return;
    const p=sourcePoint(event);
    if(dragging.edit)brush(p,dragging.p);
    else {const l=window.outputFormat.logicalDimensions();state.x=clamp(state.x+(p.logicalX-dragging.p.logicalX)/l.width,-1,1);state.y=clamp(state.y+(p.logicalY-dragging.p.logicalY)/l.height,-1,1);schedule();}
    dragging.p=p;
  });
  function endDrag(event){if(!dragging||event.pointerId!==dragging.id)return;const edited=dragging.edit;dragging=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(edited){maskChanged();status('ready','Selection updated · choose Done to see the aura.');}}
  canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);canvas.addEventListener('lostpointercapture',endDrag);
  canvas.addEventListener('keydown',event=>{
    if(!state.source||state.processing)return;
    if(event.key==='Escape'){edit(false);return;}
    if(event.key==='Enter'&&state.editing&&state.mode==='point'){event.preventDefault();pick({x:.5,y:.5});return;}
    if(state.editing||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();const l=window.outputFormat.logicalDimensions(),step=event.shiftKey?10:1;
    if(event.key==='ArrowLeft')state.x-=step/l.width;if(event.key==='ArrowRight')state.x+=step/l.width;if(event.key==='ArrowUp')state.y-=step/l.height;if(event.key==='ArrowDown')state.y+=step/l.height;
    state.x=clamp(state.x,-1,1);state.y=clamp(state.y,-1,1);schedule();
  });
  function reset(){Object.assign(state,defaults());state.editing=false;cache=null;sync();schedule();showToast('Aura settings reset. Your image and subject selection are kept.');}
  function preset(name){
    const presets={chalk:{count:4,spacing:26,thickness:10,gap:12,roughness:65,colors:['#fffbed','#d6ff45','#4b69ff'],multicolor:false},electric:{count:5,spacing:15,thickness:13,gap:8,roughness:10,colors:['#d6ff45','#4b69ff','#ff705e'],multicolor:true},ink:{count:5,spacing:18,thickness:4,gap:10,roughness:40,colors:['#171914','#e2633e','#315dca'],multicolor:false}};
    Object.assign(state,presets[name],{preset:name});sync();schedule();
  }
  function hasMask(){
    const logical=window.outputFormat.logicalDimensions();
    return Boolean(state.source && state.cutout && fieldFor(logical.width,logical.height));
  }
  function exportImage(type){
    if(!state.source||state.processing||!hasMask()){showToast('Select a subject before exporting.');return;}
    const target=document.createElement('canvas');
    const logical=type==='jpeg'?{width:900,height:900}:window.outputFormat.logicalDimensions();
    const dimensions=type==='jpeg'?{width:3000,height:3000}:window.outputFormat.dimensions(state.outputWidth);
    renderArt(target,dimensions.width,dimensions.height,logical.width,logical.height,false);
    const filename=(state.name||'contour-aura').replace(/\.[^.]+$/,'').replace(/[^a-z0-9-]/gi,'-')+`-aura-${dimensions.width}x${dimensions.height}.${type==='jpeg'?'jpg':'png'}`;
    const form=document.createElement('form');form.method='POST';form.action='/api/export';form.target='fieldStudyDownload';form.hidden=true;
    for(const [name,value] of [['image',target.toDataURL('image/'+type,.94)],['filename',filename]]){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);}
    document.body.append(form);form.submit();requestAnimationFrame(()=>form.remove());showToast(`${type==='jpeg'?'JPEG':'PNG'} exported · ${dimensions.width} × ${dimensions.height}`);
  }
  async function demo(){
    if(state.processing)return;
    const id=++operation;request?.abort();busy(true,'Opening the botanical sample');
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200"><defs><linearGradient id="leaf" x2="1" y2="1"><stop stop-color="#477d52"/><stop offset="1" stop-color="#183d30"/></linearGradient><linearGradient id="pot" x2="1" y2="0"><stop stop-color="#ac5133"/><stop offset=".55" stop-color="#df9a68"/><stop offset="1" stop-color="#944d37"/></linearGradient></defs><g stroke-linecap="round" transform="translate(45 60) scale(.9)"><path d="M457 940 Q433 580 469 300 M452 800 Q376 670 304 633 M450 640 Q542 538 603 470 M454 524 Q385 421 343 405" fill="none" stroke="#3e6040" stroke-width="18"/><g fill="url(#leaf)"><path d="M467 408 C356 326 379 178 493 151 C541 264 548 347 467 408Z"/><path d="M342 421 C216 447 158 312 203 239 C332 251 391 348 342 421Z"/><path d="M586 502 C532 379 623 258 727 282 C727 414 667 490 586 502Z"/><path d="M316 650 C167 649 126 557 165 469 C285 462 383 557 316 650Z"/><path d="M469 765 C470 626 621 579 701 645 C649 765 558 819 469 765Z"/><path d="M424 850 C301 865 245 775 274 708 C354 696 447 775 424 850Z"/></g><g fill="none" stroke="#c2cf84" stroke-opacity=".32" stroke-width="3"><path d="M467 398L493 169 M340 415L214 252 M591 486L713 299 M310 635L175 482 M485 759L688 652"/></g><path d="M340 901 H564 L538 1090 Q451 1120 365 1090Z" fill="url(#pot)"/><ellipse cx="452" cy="901" rx="112" ry="29" fill="#b9724f"/><ellipse cx="452" cy="899" rx="92" ry="17" fill="#3d382a"/><path d="M451 899V865" stroke="#3e6040" stroke-width="16"/></g></svg>`;
    const maskUrl=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
    try{
      const subject=await loadImage(maskUrl);if(id!==operation)return;
      const photo=document.createElement('canvas');photo.width=900;photo.height=1200;const ctx=photo.getContext('2d');const g=ctx.createLinearGradient(0,0,900,1200);g.addColorStop(0,'#b9bbaa');g.addColorStop(1,'#778d7d');ctx.fillStyle=g;ctx.fillRect(0,0,900,1200);ctx.fillStyle='#8c9985';ctx.fillRect(0,1000,900,200);ctx.fillStyle='rgba(20,40,30,.14)';ctx.beginPath();ctx.ellipse(451,1062,135,25,0,0,Math.PI*2);ctx.fill();ctx.drawImage(subject,0,0);
      const blob=await new Promise(resolve=>photo.toBlob(resolve));if(id!==operation)return;const url=URL.createObjectURL(blob);const source=await loadImage(url);if(id!==operation){URL.revokeObjectURL(url);return;}
      if(state.url)URL.revokeObjectURL(state.url);
      Object.assign(state,defaults(),{source,file:new File([blob],'botanical-sample.png',{type:'image/png'}),url,name:'botanical-sample.png',undo:[],editing:false,sourceEpoch:state.sourceEpoch+1});state.mask.width=900;state.mask.height=1200;applyMask(subject);
      state.palette=window.projectPalette.extract(source,8);$('#auraSourceThumb').src=url;$('#auraSourceName').textContent='Botanical sample';$('#auraSourceMeta').textContent='Illustrated demo · replace with your photograph';$('#auraSourcePreview').hidden=false;$('#auraDropIdle').hidden=true;$('#auraEmpty').hidden=true;updateHeader();status('ready','Botanical sample ready · try a preset, then add your own photo.');
    }catch(error){if(id===operation)status('error','The sample could not be opened. Please choose an image.');}
    finally{URL.revokeObjectURL(maskUrl);if(id===operation){busy(false);schedule();}}
  }
  $('#auraSourceInput').addEventListener('change',event=>{loadFile(event.target.files[0]);event.target.value='';});
  $('#auraEmptyChoose').addEventListener('click',()=>$('#auraSourceInput').click());
  for(const id of ['auraDemo','auraEmptyDemo'])$('#'+id).addEventListener('click',demo);
  const drop=$('#auraDropZone');
  for(const type of ['dragenter','dragover'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.add('dragging');});
  for(const type of ['dragleave','drop'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove('dragging');if(type==='drop')loadFile(event.dataTransfer.files[0]);});
  $('#auraAuto').addEventListener('click',automatic);$('#auraRefine').addEventListener('click',()=>edit(!state.editing));$('#auraDone').addEventListener('click',()=>edit(false));
  $('#auraUndo').addEventListener('click',()=>{const last=state.undo.pop();if(last){state.mask.getContext('2d').putImageData(last,0,0);maskChanged();}});
  $('#auraClearMask').addEventListener('click',()=>{rememberMask();state.mask.getContext('2d').clearRect(0,0,state.mask.width,state.mask.height);state.mode='paint';maskChanged();status('ready','Selection cleared. Paint a shape to surround with rings.');});
  document.querySelectorAll('[data-aura-mode]').forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.auraMode;sync();}));
  document.querySelectorAll('[data-aura-preset]').forEach(b=>b.addEventListener('click',()=>preset(b.dataset.auraPreset)));
  [['Count','count'],['Spacing','spacing'],['Thickness','thickness'],['Gap','gap'],['Roughness','roughness'],['Scale','scale'],['Dim','dim'],['Brush','brush']].forEach(([id,key])=>$('#aura'+id).addEventListener('input',e=>{state[key]=Number(e.target.value);if(!['scale','dim','brush'].includes(key))state.preset='';sync();schedule();}));
  ['Color1','Color2','Color3','Background'].forEach((id,i)=>$('#aura'+id).addEventListener('input',e=>{if(i<3)state.colors[i]=e.target.value;else state.background=e.target.value;state.preset='';sync();schedule();}));
  $('#auraMulticolor').addEventListener('change',e=>{state.multicolor=e.target.checked;state.preset='';sync();schedule();});
  for(const [id,key] of [['Backdrop','backdrop'],['Fit','fit']])$('#aura'+id).addEventListener('change',e=>{state[key]=e.target.value;schedule();});
  $('#auraReroll').addEventListener('click',()=>{state.seed++;schedule();});
  $('#auraCenter').addEventListener('click',()=>{state.x=0;state.y=0;state.scale=100;sync();schedule();});
  window.contourAura={activate(){updateHeader();sync();schedule();},refreshFormat(){cache=null;schedule();},reset,hasContent:()=>Boolean(state.source),getExportOptions:()=>({canExport:!state.processing&&hasMask(),motionAvailable:false,outputWidth:state.outputWidth}),setOutputWidth(width){state.outputWidth=[900,1350,3000].includes(Number(width))?Number(width):900;schedule();},exportPng:()=>exportImage('png'),exportJpeg:()=>exportImage('jpeg')};
  sync();render();
})();
