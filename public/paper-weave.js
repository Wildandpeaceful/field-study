(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const canvas = $('#weaveCanvas');
  if (!canvas) return;
  const clamp = (n,lo,hi) => Math.max(lo,Math.min(hi,n));
  const makeCanvas = (width,height) => Object.assign(document.createElement('canvas'),{width,height});
  const defaults = () => ({strip:72,gap:7,offset:3,tilt:.25,fringe:16,margin:7,shadow:44,texture:22,background:'#eee7d8',pattern:'plain',flip:false,seed:7,preset:'clean'});
  const state = {...defaults(),a:null,b:null,active:'a',loading:{a:false,b:false,demo:false},palette:window.projectPalette.fallback,outputWidth:window.outputFormat.get().shortEdge};
  const loads={a:0,b:0};
  let demoId=0,revision=0,frame=0,dragging=null;
  const photoCache={a:null,b:null};
  const processing=()=>Object.values(state.loading).some(Boolean);
  const toast=message=>window.fieldStudyShell.showToast(message);
  const loadImage=url=>new Promise((resolve,reject)=>{
    const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This image could not be opened. Try JPG, PNG, or WebP.'));image.src=url;
  });
  function status(kind,message){$('#weaveStatus').className='process-status '+kind;$('#weaveStatusText').textContent=message;}
  function schedule(){if(!frame)frame=requestAnimationFrame(render);}
  function clearCache(){photoCache.a=null;photoCache.b=null;}
  function makeSource(source,url,name){return {source,url,name,revision:++revision,x:0,y:0,zoom:100,fit:'cover'};}
  function syncSource(slot){
    const name=slot.toUpperCase(),photo=state[slot];
    $('#weavePreview'+name).hidden=!photo;$('#weaveIdle'+name).hidden=Boolean(photo);
    if(photo){$('#weaveThumb'+name).src=photo.url;$('#weaveName'+name).textContent=photo.name;$('#weaveMeta'+name).textContent=`${photo.source.naturalWidth} × ${photo.source.naturalHeight} · local`;}
    else $('#weaveThumb'+name).removeAttribute('src');
  }
  function updateHeader(){
    if(document.body.dataset.activeTool==='weave')$('#fileNameHeader').textContent=state.a?state.a.name.replace(/\.[^.]+$/,'').toUpperCase():'PAPER WEAVE';
  }
  function updatePalette(){
    const sources=[state.a?.source,state.b?.source].filter(Boolean);
    state.palette=sources.length?window.projectPalette.extract(sources,8):window.projectPalette.fallback;
  }
  function sync(){
    for(const [id,key,unit] of [['Strip','strip',' px'],['Gap','gap',' px'],['Offset','offset',' px'],['Tilt','tilt','°'],['Fringe','fringe',' px'],['Shadow','shadow','%'],['Texture','texture','%'],['Margin','margin','%']]){
      $('#weave'+id).value=state[key];$('#weave'+id+'Output').textContent=state[key]+unit;
    }
    const photo=state[state.active];
    $('#weaveActiveImage').value=state.active;$('#weaveActiveImage').options[1].disabled=!state.b;
    $('#weaveZoom').value=photo?.zoom||100;$('#weaveZoomOutput').textContent=(photo?.zoom||100)+'%';
    $('#weaveFit').value=photo?.fit||'cover';
    for(const id of ['Zoom','Fit','Center'])$('#weave'+id).disabled=!photo||processing();
    $('#weavePattern').value=state.pattern;$('#weaveFlip').checked=state.flip;
    $('#weaveBackground').value=state.background;$('#weaveBackgroundOutput').textContent=state.background.toUpperCase();
    $('#weaveRemoveB').disabled=!state.b||processing();$('#weaveSwap').disabled=!state.a||!state.b||processing();
    $('#weaveBusy').hidden=!processing();$('#weaveEmpty').hidden=Boolean(state.a);
    for(const id of ['Demo','PairDemo','EmptyDemo'])$('#weave'+id).disabled=processing();
    document.querySelectorAll('[data-weave-preset]').forEach(button=>{
      const selected=button.dataset.weavePreset===state.preset;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
    });
    $('#weaveHelp').textContent=!state.a?'Add your first photograph to begin.':!state.b?'One photograph · drag to reframe both strip directions.':`Drag to reframe the ${state.active==='a'?'first photograph / vertical':'second photograph / horizontal'} strips · choose Photo framing to switch.`;
    window.projectPalette.render($('#weavePalette'),state.palette,color=>{state.background=color;state.preset='';sync();schedule();},state.background);
  }
  function fittedPhoto(slot,width,height,logicalWidth,logicalHeight,layout){
    const photo=state[slot];
    const key=[photo.revision,width,height,logicalWidth,logicalHeight,layout.bounds.x,layout.bounds.y,layout.bounds.width,layout.bounds.height,photo.x,photo.y,photo.zoom,photo.fit,state.background].join(':');
    if(photoCache[slot]?.key===key)return photoCache[slot].canvas;
    const fitted=makeCanvas(width,height),ctx=fitted.getContext('2d'),unit=width/logicalWidth,b=layout.bounds;
    const sw=photo.source.naturalWidth,sh=photo.source.naturalHeight;
    const factor=(photo.fit==='cover'?Math.max(b.width/sw,b.height/sh):Math.min(b.width/sw,b.height/sh))*photo.zoom/100;
    const dw=sw*factor,dh=sh*factor;
    ctx.fillStyle=state.background;ctx.fillRect(0,0,width,height);
    ctx.drawImage(photo.source,(b.x+(b.width-dw)/2+photo.x*logicalWidth)*unit,(b.y+(b.height-dh)/2+photo.y*logicalHeight)*unit,dw*unit,dh*unit);
    photoCache[slot]={key,canvas:fitted};return fitted;
  }
  function renderArt(target,width,height,logicalWidth,logicalHeight){
    if(target.width!==width)target.width=width;if(target.height!==height)target.height=height;
    const ctx=target.getContext('2d',{willReadFrequently:true});ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);
    if(!state.a){ctx.fillStyle=state.background;ctx.fillRect(0,0,width,height);return;}
    const unit=width/logicalWidth,layout=window.WeaveEngine.plan(logicalWidth,logicalHeight,state);
    const a=fittedPhoto('a',width,height,logicalWidth,logicalHeight,layout);
    const b=state.b?fittedPhoto('b',width,height,logicalWidth,logicalHeight,layout):a;
    ctx.scale(unit,unit);window.WeaveEngine.render(ctx,a,b,logicalWidth,logicalHeight,state,unit);ctx.setTransform(1,0,0,1,0,0);
    if(state.texture){
      const image=ctx.getImageData(0,0,width,height);
      window.WeaveEngine.texture(image.data,width,height,state.texture,state.seed,unit*layout.unit);ctx.putImageData(image,0,0);
    }
  }
  function render(){
    frame=0;const logical=window.outputFormat.logicalDimensions(),scale=Math.min(1,1000/Math.max(logical.width,logical.height));
    renderArt(canvas,Math.round(logical.width*scale),Math.round(logical.height*scale),logical.width,logical.height);
    window.outputFormat.applyShell($('#weaveArtboardShell'));
    const dimensions=window.outputFormat.dimensions(state.outputWidth),layout=window.WeaveEngine.plan(logical.width,logical.height,state);
    $('#weaveDimensions').textContent=`${dimensions.width} × ${dimensions.height} PX`;
    $('#weaveModeLabel').textContent=`${layout.columns} VERTICAL / ${layout.rows} HORIZONTAL`;
  }
  async function loadFile(file,slot){
    if(!file)return;
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type)){toast('Choose a JPG, PNG, or WebP image.');return;}
    if(file.size>30*1024*1024){toast('Choose an image smaller than 30 MB.');return;}
    demoId++;state.loading.demo=false;
    const id=++loads[slot],url=URL.createObjectURL(file);state.loading[slot]=true;sync();
    try{
      const source=await loadImage(url);
      if(id!==loads[slot]){URL.revokeObjectURL(url);return;}
      if(source.naturalWidth*source.naturalHeight>48e6)throw new Error('Resize this photograph below 48 megapixels before opening it.');
      if(state[slot])URL.revokeObjectURL(state[slot].url);
      state[slot]=makeSource(source,url,file.name);state.active=slot;clearCache();syncSource(slot);updatePalette();updateHeader();
      status('ready',!state.a?'Second photo ready · add the first photograph to begin.':state.b?'Two photographs ready · vertical meets horizontal.':'Photograph ready · both directions use this image.');
    }catch(error){URL.revokeObjectURL(url);if(id===loads[slot]){status('error',error.message);toast(error.message);}}
    finally{if(id===loads[slot]){state.loading[slot]=false;sync();schedule();}}
  }
  function removeSecond(){
    if(processing())return;
    loads.b++;if(state.b)URL.revokeObjectURL(state.b.url);state.b=null;state.active='a';clearCache();syncSource('b');updatePalette();sync();schedule();
    status(state.a?'ready':'',state.a?'Using the first photograph in both strip directions.':'Add the first photograph to begin.');
  }
  function swap(){
    if(!state.a||!state.b||processing())return;
    [state.a,state.b]=[state.b,state.a];clearCache();syncSource('a');syncSource('b');updatePalette();updateHeader();sync();schedule();status('ready','Photographs swapped · vertical and horizontal sources exchanged.');
  }
  async function canvasSource(surface,name){
    const blob=await new Promise(resolve=>surface.toBlob(resolve));
    if(!blob)throw new Error('Could not prepare the sample.');
    const url=URL.createObjectURL(blob);
    try{return makeSource(await loadImage(url),url,name);}catch(error){URL.revokeObjectURL(url);throw error;}
  }
  async function demo(paired=false){
    if(processing())return;
    const id=++demoId;state.loading.demo=true;sync();let a=null,b=null,committed=false;
    try{
      const subject=await loadImage('/frost-sample.svg');if(id!==demoId)return;
      const botanical=makeCanvas(900,1200),ctx=botanical.getContext('2d');
      const g=ctx.createLinearGradient(0,0,900,1200);g.addColorStop(0,'#bac0a9');g.addColorStop(1,'#698b77');ctx.fillStyle=g;ctx.fillRect(0,0,900,1200);
      ctx.fillStyle='#8b9c83';ctx.fillRect(0,1025,900,175);ctx.drawImage(subject,0,0);
      a=await canvasSource(botanical,'Botanical sample');
      if(paired){
        const color=makeCanvas(900,1200),cc=color.getContext('2d');
        const bg=cc.createLinearGradient(0,0,900,1200);bg.addColorStop(0,'#d99c70');bg.addColorStop(1,'#eac8a3');cc.fillStyle=bg;cc.fillRect(0,0,900,1200);
        cc.fillStyle='#b95e42';cc.beginPath();cc.ellipse(430,490,300,340,-.18,0,Math.PI*2);cc.fill();
        cc.fillStyle='#ead4ac';cc.fillRect(145,805,610,220);
        cc.fillStyle='#375449';cc.beginPath();cc.arc(510,930,142,0,Math.PI*2);cc.fill();
        b=await canvasSource(color,'Color study');
      }
      if(id!==demoId)return;
      if(state.a)URL.revokeObjectURL(state.a.url);if(state.b)URL.revokeObjectURL(state.b.url);
      Object.assign(state,defaults(),{a,b,active:'a'});committed=true;clearCache();syncSource('a');syncSource('b');updatePalette();updateHeader();
      $('#weaveMetaA').textContent='Illustrated sample · replace with your photograph';
      if(b)$('#weaveMetaB').textContent='Illustrated color study · optional second source';
      status('ready',paired?'Paired sample ready · try Reverse crossings or Swap photos.':'Sample ready · try a preset or add a second photograph.');
    }catch(error){if(id===demoId){status('error','The sample could not be opened. Please choose a photograph.');}}
    finally{
      if(!committed){if(a)URL.revokeObjectURL(a.url);if(b)URL.revokeObjectURL(b.url);}
      if(id===demoId){state.loading.demo=false;sync();schedule();}
    }
  }
  function reset(){
    loads.a++;loads.b++;demoId++;state.loading={a:false,b:false,demo:false};
    Object.assign(state,defaults(),{active:'a'});
    for(const slot of ['a','b'])if(state[slot])Object.assign(state[slot],{x:0,y:0,zoom:100,fit:'cover'});
    clearCache();sync();schedule();status(state.a?'ready':'',state.a?'Weave settings reset · your photographs are kept.':'Add a photograph or try a sample weave.');
    toast('Weave settings reset. Both source photographs are kept.');
  }
  function preset(name){
    const presets={
      clean:{strip:72,gap:7,offset:3,tilt:.25,fringe:16,shadow:44,texture:22,pattern:'plain'},
      handmade:{strip:76,gap:12,offset:16,tilt:1.3,fringe:28,shadow:64,texture:42,pattern:'plain'},
      basket:{strip:52,gap:5,offset:2,tilt:.1,fringe:14,shadow:48,texture:26,pattern:'basket'}
    };
    Object.assign(state,presets[name],{preset:name});sync();schedule();
  }
  function point(event){const rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};}
  canvas.addEventListener('pointerdown',event=>{
    if(!state.a||!state[state.active]||processing()||event.button!==0)return;
    event.preventDefault();canvas.focus();canvas.setPointerCapture(event.pointerId);dragging={id:event.pointerId,point:point(event),slot:state.active};
  });
  canvas.addEventListener('pointermove',event=>{
    if(!dragging||event.pointerId!==dragging.id)return;
    const next=point(event),photo=state[dragging.slot];if(!photo)return;
    photo.x=clamp(photo.x+next.x-dragging.point.x,-1,1);photo.y=clamp(photo.y+next.y-dragging.point.y,-1,1);dragging.point=next;schedule();
  });
  function endDrag(event){if(!dragging||event.pointerId!==dragging.id)return;dragging=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,endDrag);
  canvas.addEventListener('keydown',event=>{
    const photo=state[state.active];if(!state.a||!photo||processing()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const l=window.outputFormat.logicalDimensions(),step=event.shiftKey?10:1;
    if(event.key==='ArrowLeft')photo.x-=step/l.width;if(event.key==='ArrowRight')photo.x+=step/l.width;
    if(event.key==='ArrowUp')photo.y-=step/l.height;if(event.key==='ArrowDown')photo.y+=step/l.height;
    photo.x=clamp(photo.x,-1,1);photo.y=clamp(photo.y,-1,1);schedule();
  });
  function exportImage(type){
    if(!state.a||processing()){toast('Add the first photograph before exporting.');return;}
    const logical=type==='jpeg'?{width:900,height:900}:window.outputFormat.logicalDimensions();
    const size=type==='jpeg'?{width:3000,height:3000}:window.outputFormat.dimensions(state.outputWidth),target=makeCanvas(size.width,size.height);
    try{
      renderArt(target,size.width,size.height,logical.width,logical.height);
      const filename=(state.a.name||'paper-weave').replace(/\.[^.]+$/,'').replace(/[^a-z0-9-]/gi,'-')+`-weave-${size.width}x${size.height}.${type==='jpeg'?'jpg':'png'}`;
      const form=document.createElement('form');form.method='POST';form.action='/api/export';form.target='fieldStudyDownload';form.hidden=true;
      for(const [name,value] of [['image',target.toDataURL('image/'+type,.94)],['filename',filename]]){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);}
      document.body.append(form);form.submit();requestAnimationFrame(()=>form.remove());toast(`${type==='jpeg'?'JPEG':'PNG'} exported · ${size.width} × ${size.height}`);
    }catch(error){toast('This image could not be exported. Try the standard PNG size.');}
    finally{clearCache();schedule();}
  }
  for(const slot of ['a','b']){
    const id=slot.toUpperCase();$('#weaveInput'+id).addEventListener('change',event=>{loadFile(event.target.files[0],slot);event.target.value='';});
    const drop=$('#weaveDrop'+id);
    for(const type of ['dragenter','dragover'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.add('dragover');});
    for(const type of ['dragleave','drop'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove('dragover');if(type==='drop')loadFile(event.dataTransfer.files[0],slot);});
  }
  $('#weaveEmptyChoose').addEventListener('click',()=>$('#weaveInputA').click());
  $('#weaveDemo').addEventListener('click',()=>demo(false));$('#weaveEmptyDemo').addEventListener('click',()=>demo(false));$('#weavePairDemo').addEventListener('click',()=>demo(true));
  $('#weaveSwap').addEventListener('click',swap);$('#weaveRemoveB').addEventListener('click',removeSecond);
  document.querySelectorAll('[data-weave-preset]').forEach(button=>button.addEventListener('click',()=>preset(button.dataset.weavePreset)));
  for(const [id,key] of [['Strip','strip'],['Gap','gap'],['Offset','offset'],['Tilt','tilt'],['Fringe','fringe'],['Shadow','shadow'],['Texture','texture'],['Margin','margin']]){
    $('#weave'+id).addEventListener('input',event=>{state[key]=Number(event.target.value);state.preset='';sync();schedule();});
  }
  $('#weavePattern').addEventListener('change',event=>{state.pattern=event.target.value;state.preset='';sync();schedule();});
  $('#weaveFlip').addEventListener('change',event=>{state.flip=event.target.checked;schedule();});
  $('#weaveBackground').addEventListener('input',event=>{state.background=event.target.value;sync();schedule();});
  $('#weaveReroll').addEventListener('click',()=>{state.seed++;schedule();});
  $('#weaveActiveImage').addEventListener('change',event=>{state.active=event.target.value==='b'&&state.b?'b':'a';sync();});
  $('#weaveFit').addEventListener('change',event=>{if(state[state.active]){state[state.active].fit=event.target.value;schedule();}});
  $('#weaveZoom').addEventListener('input',event=>{if(state[state.active]){state[state.active].zoom=Number(event.target.value);sync();schedule();}});
  $('#weaveCenter').addEventListener('click',()=>{const photo=state[state.active];if(photo){photo.x=photo.y=0;photo.zoom=100;sync();schedule();}});
  window.paperWeave={activate(){updateHeader();sync();schedule();},refreshFormat(){clearCache();schedule();},reset,hasContent:()=>Boolean(state.a||state.b),
    getExportOptions:()=>({canExport:Boolean(state.a)&&!processing(),motionAvailable:false,outputWidth:state.outputWidth}),
    setOutputWidth(width){state.outputWidth=[900,1350,3000].includes(Number(width))?Number(width):900;schedule();},exportPng:()=>exportImage('png'),exportJpeg:()=>exportImage('jpeg')};
  sync();render();
})();
