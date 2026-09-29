(() => {
  'use strict';
  const $=s=>document.querySelector(s),canvas=$('#collageCanvas');if(!canvas)return;
  const E=window.CollageEngine,{clamp}=E,make=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
  const fonts={bold:'Arial, sans-serif',sans:'"Helvetica Neue", Arial, sans-serif',serif:'Georgia, serif',mono:'"Courier New", monospace'};
  const state={...E.preset(),sources:{},selected:'main',move:'frame',loading:false,dirty:false,outputWidth:window.outputFormat.get().shortEdge};
  let frameId=0,epoch=0,drag=null,bounds=[],grainTile=null;
  const selected=()=>state.layers.find(l=>l.id===state.selected),toast=m=>window.fieldStudyShell.showToast(m);
  const schedule=()=>{if(!frameId)frameId=requestAnimationFrame(render);};
  const changed=()=>{state.dirty=true;state.preset='';schedule();syncPreset();};
  const hasPhoto=()=>state.layers.some(l=>l.kind==='photo'&&l.visible&&l.opacity>0&&state.sources[l.id]);
  function status(message,error=false){$('#collageStatus').className='process-status '+(error?'error':'ready');$('#collageStatusText').textContent=message;}
  function syncPreset(){document.querySelectorAll('[data-collage-preset]').forEach(b=>{const on=b.dataset.collagePreset===state.preset;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));b.disabled=state.loading;});}
  function syncLayers(){
    const container=$('#collageLayers'),active=document.activeElement?.dataset.collageLayer;
    container.replaceChildren();
    [...state.layers].reverse().forEach(l=>{
      const b=document.createElement('button');b.type='button';b.dataset.collageLayer=l.id;b.setAttribute('aria-pressed',String(l.id===state.selected));b.disabled=state.loading;
      const icon=document.createElement('i'),copy=document.createElement('span'),title=document.createElement('strong'),note=document.createElement('small'),src=state.sources[l.id];
      if(src){const img=document.createElement('img');img.src=src.url;img.alt='';icon.append(img);}else icon.textContent=l.kind==='text'?'Aa':'+';
      title.textContent=l.label;note.textContent=!l.visible?'Hidden':l.kind==='photo'?(src?.name||'Add a photograph'):(l.text.trim()||'Empty text');
      copy.append(title,note);b.append(icon,copy);b.addEventListener('click',()=>selectLayer(l.id));container.append(b);
    });
    if(active)container.querySelector(`[data-collage-layer="${active}"]`)?.focus({preventScroll:true});
    const index=state.layers.indexOf(selected());$('#collageForward').disabled=index===state.layers.length-1||state.loading;$('#collageBackward').disabled=index===0||state.loading;
  }
  function sync(){
    const l=selected(),photo=l.kind==='photo',source=state.sources[l.id];syncPreset();syncLayers();
    $('#collageSelectionLabel').textContent=l.label;$('#collagePhotoControls').hidden=!photo;$('#collageTextControls').hidden=photo;
    $('#collageEditor').disabled=state.loading;$('#collageVisible').checked=l.visible;$('#collageVisible').disabled=state.loading;
    $('#collageBusy').hidden=!state.loading;$('#collageDemo').disabled=state.loading;
    $('#collageSourcePreview').hidden=!source;$('#collageSourceIdle').hidden=Boolean(source);
    $('#collageInput').setAttribute('aria-label',`Choose image for ${l.label}`);
    if(source){$('#collageThumb').src=source.url;$('#collageSourceName').textContent=source.name;$('#collageSourceMeta').textContent=`${source.image.naturalWidth} × ${source.image.naturalHeight} · local`;}
    else $('#collageThumb').removeAttribute('src');
    $('#collageRemove').disabled=!source||state.loading;$('#collageMove').value=state.move;
    for(const [id,key,unit,mult] of [['Width','w','%',100],['Height','h','%',100],['Zoom','zoom','%',1],['Mono','mono','%',1],['Border','border',' px',1],['Shadow','shadow','%',1],['Size','size',' px',1],['Tracking','tracking',' px',1],['Leading','leading','%',1],['Rotation','rotation','°',1],['Opacity','opacity','%',1]]){
      if(l[key]===undefined)continue;const n=Math.round(l[key]*mult);$('#collage'+id).value=n;$('#collage'+id+'Output').textContent=n+unit;
    }
    if(photo){$('#collageFit').value=l.fit;for(const id of ['Move','Zoom','Mono','CenterCrop'])$('#collage'+id).disabled=!source;}
    else{
      $('#collageTextLabel').textContent=l.label;if($('#collageText').value!==l.text)$('#collageText').value=l.text;
      $('#collageFont').value=l.font;$('#collageAlign').value=l.align;$('#collageInk').value=l.color;$('#collageInkOutput').textContent=l.color.toUpperCase();
    }
    for(const [id,key] of [['Margin','margin'],['Grain','grain']]){$('#collage'+id).value=state[key];$('#collage'+id+'Output').textContent=state[key]+'%';}
    $('#collageBackground').value=state.background;$('#collageBackgroundOutput').textContent=state.background.toUpperCase();
    $('#collageHelp').textContent=!l.visible?`${l.label} is hidden · enable “Show selected layer” to edit it on the cover.`:photo&&state.move==='crop'?'Drag inside the selected photo to change its crop. The frame stays in place.':`${l.label} selected · drag to move · square handle scales · round handle rotates.`;
    if(document.body.dataset.activeTool==='collage')$('#fileNameHeader').textContent='EDITORIAL COLLAGE';
  }
  function selectLayer(id){state.selected=id;state.move='frame';sync();schedule();}
  function textWidth(ctx,text,tracking){const chars=Array.from(text);return Math.max(1,(tracking?chars.reduce((n,c)=>n+ctx.measureText(c).width,0):ctx.measureText(text).width)+Math.max(0,chars.length-1)*tracking);}
  function textMetrics(ctx,l,w,h){
    const size=l.size*Math.min(w,h)/900,tracking=l.tracking*Math.min(w,h)/900;
    ctx.font=`${l.font==='bold'?900:400} ${size}px ${fonts[l.font]}`;
    const lines=l.text.split('\n'),width=Math.max(1,...lines.map(line=>textWidth(ctx,line,tracking))),height=lines.length*size*l.leading/100;
    const r=E.frame(l,w,h,state.margin);return{...r,width,height,size,tracking,lines};
  }
  function photoRect(l,r){const image=state.sources[l.id]?.image;return image?E.fittedRect(image.naturalWidth,image.naturalHeight,r.width,r.height,l.zoom,l.cropX,l.cropY,l.fit):null;}
  function grain(){
    if(grainTile)return grainTile;grainTile=make(256,256);const ctx=grainTile.getContext('2d'),data=ctx.createImageData(256,256);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4,v=Math.round(E.noise(x,y)*255);data.data[i]=data.data[i+1]=data.data[i+2]=v;data.data[i+3]=255;}ctx.putImageData(data,0,0);return grainTile;
  }
  function renderArt(target,width,height,logical,preview=false){
    if(target.width!==width||target.height!==height){target.width=width;target.height=height;}
    const ctx=target.getContext('2d'),scale=width/logical.width,unit=Math.min(logical.width,logical.height)/900,out=[];
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.fillStyle=state.background;ctx.fillRect(0,0,width,height);
    ctx.save();ctx.scale(scale,scale);
    for(const l of state.layers){
      if(!l.visible)continue;const photo=l.kind==='photo',source=state.sources[l.id];if(!photo&&!l.text.trim())continue;
      const r=photo?E.frame(l,logical.width,logical.height,state.margin):textMetrics(ctx,l,logical.width,logical.height);out.push({id:l.id,...r});
      ctx.save();ctx.translate(r.x,r.y);ctx.rotate(r.rotation*Math.PI/180);ctx.globalAlpha=l.opacity/100;
      if(photo){
        if(source||preview){
          const border=l.border*unit;
          ctx.fillStyle=source?state.background:'#e0dfd7';
          ctx.shadowColor=`rgba(0,0,0,${l.shadow/100*.6})`;ctx.shadowBlur=l.shadow*.4*unit*scale;ctx.shadowOffsetX=2*unit*scale;ctx.shadowOffsetY=l.shadow*.16*unit*scale;
          ctx.fillRect(-r.width/2-border,-r.height/2-border,r.width+border*2,r.height+border*2);ctx.shadowColor='transparent';ctx.shadowBlur=ctx.shadowOffsetX=ctx.shadowOffsetY=0;
          if(source){
            ctx.save();ctx.beginPath();ctx.rect(-r.width/2,-r.height/2,r.width,r.height);ctx.clip();const p=photoRect(l,r);ctx.filter=`grayscale(${l.mono/100})`;ctx.drawImage(source.image,p.x,p.y,p.width,p.height);ctx.restore();
          }else{
            ctx.strokeStyle='#b4b6ac';ctx.lineWidth=unit;ctx.setLineDash([5*unit,5*unit]);ctx.strokeRect(-r.width/2,-r.height/2,r.width,r.height);ctx.setLineDash([]);
            ctx.fillStyle='#75796d';ctx.font=`${Math.min(18*unit,r.width/9)}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(l.label.toUpperCase(),0,-10*unit);ctx.font=`${Math.min(11*unit,r.width/12)}px Arial`;ctx.fillText('Select layer · add image',0,14*unit);
          }
        }
      }else{
        ctx.fillStyle=l.color;ctx.textBaseline='middle';ctx.textAlign='left';const leading=r.size*l.leading/100;
        r.lines.forEach((line,i)=>{const width=textWidth(ctx,line,r.tracking);let x=l.align==='left'?-r.width/2:l.align==='right'?r.width/2-width:-width/2,y=-r.height/2+(i+.5)*leading;
          if(!r.tracking)ctx.fillText(line,x,y);else for(const char of Array.from(line)){ctx.fillText(char,x,y);x+=ctx.measureText(char).width+r.tracking;}
        });
      }
      ctx.restore();
    }
    if(state.grain){ctx.save();ctx.globalCompositeOperation='soft-light';ctx.globalAlpha=state.grain/100*.55;ctx.scale(unit,unit);ctx.fillStyle=ctx.createPattern(grain(),'repeat');ctx.fillRect(0,0,logical.width/unit,logical.height/unit);ctx.restore();}
    ctx.restore();return out;
  }
  function render(){
    frameId=0;const logical=window.outputFormat.logicalDimensions(),scale=Math.min(1,1100/Math.max(logical.width,logical.height));bounds=renderArt(canvas,Math.round(logical.width*scale),Math.round(logical.height*scale),logical,true);
    window.outputFormat.applyShell($('#collageArtboardShell'));const d=window.outputFormat.dimensions(state.outputWidth);$('#collageDimensions').textContent=`${d.width} × ${d.height} PX`;
    $('#collageModeLabel').textContent=state.preset==='detail'?'DETAIL OVERLAY':state.preset==='stack'?'COVER STACK':'CUSTOM COLLAGE';guide(logical);
  }
  function guide(logical=window.outputFormat.logicalDimensions()){
    const svg=$('#collageGuide'),r=bounds.find(b=>b.id===state.selected);svg.toggleAttribute('hidden',!r||state.loading);if(!r)return;
    const screen=canvas.getBoundingClientRect(),unit=logical.width/(screen.width||600),h=E.handles(r,26*unit);svg.setAttribute('viewBox',`0 0 ${logical.width} ${logical.height}`);
    svg.querySelector('polygon').setAttribute('points',h.corners.map(p=>`${p.x},${p.y}`).join(' '));
    const line=svg.querySelector('line');for(const [k,v] of Object.entries({x1:h.top.x,y1:h.top.y,x2:h.rotate.x,y2:h.rotate.y}))line.setAttribute(k,v);
    const rect=svg.querySelector('rect');for(const [k,v] of Object.entries({x:h.resize.x-5*unit,y:h.resize.y-5*unit,width:10*unit,height:10*unit}))rect.setAttribute(k,v);
    const circle=svg.querySelector('circle');circle.setAttribute('cx',h.rotate.x);circle.setAttribute('cy',h.rotate.y);circle.setAttribute('r',6*unit);
  }
  function applyPreset(name,reset=false){
    const fresh=E.preset(name),copy=new Map(state.layers.filter(l=>l.kind==='text').map(l=>[l.id,l.text]));
    if(!reset)fresh.layers.forEach(l=>{if(copy.has(l.id))l.text=copy.get(l.id);});
    if(state.sources.extra)fresh.layers.find(l=>l.id==='extra').visible=true;
    Object.assign(state,fresh,{selected:name==='detail'?'detail':'main',move:'frame',dirty:true});sync();schedule();status(reset?'Cover Stack restored · your photographs are kept.':'Layout applied · your photographs and words are kept.');
  }
  function loadImage(url){return new Promise((resolve,reject)=>{const image=new Image(),timer=setTimeout(()=>done(new Error('This image took too long to open. Try another JPG, PNG, or WebP.')),20000);function done(error){clearTimeout(timer);image.onload=image.onerror=null;if(error)reject(error);else resolve(image);}image.onload=()=>done();image.onerror=()=>done(new Error('This image could not be opened. Try JPG, PNG, or WebP.'));image.src=url;});}
  function dispose(source){if(source?.url.startsWith('blob:'))URL.revokeObjectURL(source.url);}
  function commit(id,image,url,name){dispose(state.sources[id]);state.sources[id]={image,url,name};const l=state.layers.find(l=>l.id===id);Object.assign(l,{visible:true,zoom:100,cropX:0,cropY:0});state.dirty=true;}
  async function openFile(file){
    const id=selected().id;if(!file||selected().kind!=='photo')return;
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type)){status('Choose a JPG, PNG, or WebP photograph.',true);toast('Choose a JPG, PNG, or WebP photograph.');return;}
    if(file.size>30*1024*1024){status('Choose a photograph smaller than 30 MB.',true);return;}
    const token=++epoch,url=URL.createObjectURL(file);state.loading=true;sync();
    try{const image=await loadImage(url);if(token!==epoch){URL.revokeObjectURL(url);return;}if(image.naturalWidth*image.naturalHeight>48e6)throw new Error('Resize the photograph below 48 megapixels.');commit(id,image,url,file.name);status('Photo ready · drag its frame, or choose “Reframe the photo inside” to crop.');}
    catch(e){URL.revokeObjectURL(url);if(token===epoch)status(e.message,true);}
    finally{if(token===epoch){state.loading=false;sync();schedule();}}
  }
  async function demo(){
    if(state.loading)return;const token=++epoch;state.loading=true;sync();
    try{const [main,detail]=await Promise.all([loadImage('/frost-sample.svg'),loadImage('/collage-detail-sample.svg')]);if(token!==epoch)return;commit('main',main,'/frost-sample.svg','Botanical illustration');commit('detail',detail,'/collage-detail-sample.svg','Light study');if(state.preset==='detail')state.layers.find(l=>l.id==='main').zoom=185;status('Original illustrated studies · replace each photo layer with your own artwork.');}
    catch(e){if(token===epoch)status('The sample could not be opened. Choose your own photographs.',true);}
    finally{if(token===epoch){state.loading=false;sync();schedule();}}
  }
  function reset(){epoch++;state.loading=false;applyPreset('stack',true);toast('Editorial Collage reset. Your photographs are kept.');}
  function exportImage(type){
    if(!hasPhoto()||state.loading){toast('Add a visible photograph before exporting.');return;}
    const logical=type==='jpeg'?{width:900,height:900}:window.outputFormat.logicalDimensions(),d=type==='jpeg'?{width:3000,height:3000}:window.outputFormat.dimensions(state.outputWidth);
    try{
      const output=make(d.width,d.height);renderArt(output,d.width,d.height,logical);
      const title=state.layers.find(l=>l.id==='title').text.trim().replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,45)||'editorial-collage';
      const form=document.createElement('form');form.method='POST';form.action='/api/export';form.target='fieldStudyDownload';form.hidden=true;
      for(const [name,value] of [['image',output.toDataURL('image/'+type,.95)],['filename',`${title}-collage-${d.width}x${d.height}.${type==='jpeg'?'jpg':'png'}`]]){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);}
      document.body.append(form);form.submit();requestAnimationFrame(()=>form.remove());toast(`${type==='jpeg'?'JPEG':'PNG'} exported · ${d.width} × ${d.height}`);
    }catch(e){toast('The collage could not be exported. Try a smaller PNG size.');}
  }
  function point(e){const r=canvas.getBoundingClientRect(),d=window.outputFormat.logicalDimensions();return{x:(e.clientX-r.left)/r.width*d.width,y:(e.clientY-r.top)/r.height*d.height};}
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0||state.loading)return;const p=point(e),d=window.outputFormat.logicalDimensions(),screen=canvas.getBoundingClientRect(),unit=d.width/screen.width;
    let r=bounds.find(b=>b.id===state.selected),mode='move';
    if(r){const h=E.handles(r,26*unit);if(Math.hypot(p.x-h.rotate.x,p.y-h.rotate.y)<14*unit)mode='rotate';else if(Math.hypot(p.x-h.resize.x,p.y-h.resize.y)<14*unit)mode='resize';}
    if(mode==='move'){
      // In crop mode, retain the selected photograph even under an overlapping layer.
      if(!(state.move==='crop'&&selected().kind==='photo'&&r&&E.hit(p,r)))r=[...bounds].reverse().find(b=>E.hit(p,b,3*unit));
      if(!r)return;if(r.id!==state.selected)selectLayer(r.id);
      if(selected().kind==='photo'&&state.move==='crop'&&state.sources[r.id])mode='crop';
    }
    const l=selected();e.preventDefault();canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
    drag={id:e.pointerId,p,origin:p,r,mode,start:{...l},angle:Math.atan2(p.y-r.y,p.x-r.x),radius:Math.hypot(p.x-r.x,p.y-r.y)};
    schedule();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;const p=point(e),l=selected(),d=window.outputFormat.logicalDimensions(),area=E.area(d.width,d.height,state.margin);
    if(drag.mode==='move'){l.x=clamp(drag.start.x+(p.x-drag.origin.x)/area.width,-.5,1.5);l.y=clamp(drag.start.y+(p.y-drag.origin.y)/area.height,-.5,1.5);}
    if(drag.mode==='crop'){const a=E.local(p,drag.r),b=E.local(drag.p,drag.r),r=photoRect(l,drag.r);l.cropX=clamp(l.cropX+(a.x-b.x)/(r.travelX||Infinity),-1,1);l.cropY=clamp(l.cropY+(a.y-b.y)/(r.travelY||Infinity),-1,1);}
    if(drag.mode==='rotate'){let angle=drag.start.rotation+(Math.atan2(p.y-drag.r.y,p.x-drag.r.x)-drag.angle)*180/Math.PI;angle=((angle+540)%360)-180;l.rotation=e.shiftKey?Math.round(angle/15)*15:Math.round(angle);}
    if(drag.mode==='resize'){
      let factor=Math.hypot(p.x-drag.r.x,p.y-drag.r.y)/Math.max(1,drag.radius);
      if(l.kind==='photo'){factor=clamp(factor,Math.max(.05/drag.start.w,.05/drag.start.h),Math.min(1.6/drag.start.w,1.6/drag.start.h));l.w=drag.start.w*factor;l.h=drag.start.h*factor;}
      else l.size=clamp(Math.round(drag.start.size*factor),12,360);
    }
    drag.p=p;changed();
  });
  const end=e=>{if(drag?.id===e.pointerId){drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);sync();}};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,end);
  canvas.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||state.loading)return;e.preventDefault();const l=selected(),d=window.outputFormat.logicalDimensions(),a=E.area(d.width,d.height,state.margin),step=e.shiftKey?10:1;
    const dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
    if(l.kind==='photo'&&state.move==='crop'&&state.sources[l.id]){const r=bounds.find(b=>b.id===l.id);if(!r)return;const delta=E.local({x:r.x+dx,y:r.y+dy},r),p=photoRect(l,r);l.cropX=clamp(l.cropX+delta.x/(p.travelX||Infinity),-1,1);l.cropY=clamp(l.cropY+delta.y/(p.travelY||Infinity),-1,1);}
    else{l.x=clamp(l.x+dx/a.width,-.5,1.5);l.y=clamp(l.y+dy/a.height,-.5,1.5);}changed();
  });
  for(const [id,key,mult] of [['Width','w',.01],['Height','h',.01],['Zoom','zoom',1],['Mono','mono',1],['Border','border',1],['Shadow','shadow',1],['Size','size',1],['Tracking','tracking',1],['Leading','leading',1],['Rotation','rotation',1],['Opacity','opacity',1]])$('#collage'+id).addEventListener('input',e=>{selected()[key]=Number(e.target.value)*mult;changed();sync();});
  for(const [id,key] of [['Fit','fit'],['Font','font'],['Align','align']])$('#collage'+id).addEventListener('change',e=>{selected()[key]=e.target.value;changed();sync();});
  $('#collageText').addEventListener('input',e=>{selected().text=e.target.value;changed();syncLayers();});
  $('#collageInk').addEventListener('input',e=>{selected().color=e.target.value;changed();sync();});
  $('#collageMove').addEventListener('change',e=>{state.move=e.target.value;sync();schedule();});
  $('#collageVisible').addEventListener('change',e=>{selected().visible=e.target.checked;changed();sync();});
  for(const [id,direction] of [['Forward',1],['Backward',-1]])$('#collage'+id).addEventListener('click',()=>{E.reorder(state.layers,state.selected,direction);changed();sync();});
  $('#collageCenter').addEventListener('click',()=>{selected().x=selected().y=.5;changed();sync();});
  $('#collageStraighten').addEventListener('click',()=>{selected().rotation=0;changed();sync();});
  $('#collageCenterCrop').addEventListener('click',()=>{Object.assign(selected(),{zoom:100,cropX:0,cropY:0});changed();sync();});
  for(const [id,key] of [['Margin','margin'],['Grain','grain']])$('#collage'+id).addEventListener('input',e=>{state[key]=Number(e.target.value);changed();sync();});
  $('#collageBackground').addEventListener('input',e=>{state.background=e.target.value;changed();sync();});
  document.querySelectorAll('[data-collage-preset]').forEach(b=>b.addEventListener('click',()=>applyPreset(b.dataset.collagePreset)));
  $('#collageAlbum').addEventListener('click',()=>{window.outputFormat.set('square','reflow',3000);toast('Album canvas · 3000 × 3000');});
  $('#collageInput').addEventListener('change',e=>{openFile(e.target.files[0]);e.target.value='';});
  for(const type of ['dragenter','dragover','dragleave','drop'])$('#collageDrop').addEventListener(type,e=>{e.preventDefault();$('#collageDrop').classList.toggle('dragover',type==='dragenter'||type==='dragover');if(type==='drop')openFile(e.dataTransfer.files[0]);});
  $('#collageRemove').addEventListener('click',()=>{dispose(state.sources[state.selected]);delete state.sources[state.selected];changed();sync();status('Photo removed · add a replacement, or hide its layer.');});
  $('#collageDemo').addEventListener('click',demo);
  new ResizeObserver(()=>schedule()).observe($('#collageArtboardShell'));
  window.editorialCollage={activate(){sync();schedule();},refreshFormat(){drag=null;schedule();},reset,hasContent:()=>Boolean(Object.keys(state.sources).length||state.dirty),getExportOptions:()=>({canExport:hasPhoto()&&!state.loading,motionAvailable:false,outputWidth:state.outputWidth}),setOutputWidth(n){state.outputWidth=[900,1350,3000].includes(Number(n))?Number(n):900;schedule();},exportPng:()=>exportImage('png'),exportJpeg:()=>exportImage('jpeg')};
  sync();render();
})();
