(() => {
  'use strict';
  const $=s=>document.querySelector(s),canvas=$('#textFieldCanvas');if(!canvas)return;
  const E=window.TextFieldEngine,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const surface=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
  const sample='Somewhere between the noise\nand the quiet\nwe found a little room\nto be ourselves\n\nThe light kept changing\nso we stayed a while\nlooking for the ordinary\nand finding everything';
  const defaults=()=>({text:sample,unit:'word',repeat:true,columns:8,size:22,rowGap:205,density:87,jitter:78,margin:4,seed:29,font:'sans',ink:'white',color:'#d6ff45',opacity:100,dim:10,mono:0,grain:10,zoom:100,photoX:0,photoY:0,fit:'cover',clear:false,clearX:.5,clearY:.35,clearWidth:32,clearHeight:28,offsets:{},preset:'scatter',move:'word',selected:null});
  const state={...defaults(),photo:null,loading:false,dirty:false,outputWidth:window.outputFormat.get().shortEdge,playbackRate:1,sound:false,clipDuration:10,recording:false};
  const ranges=[['Columns','columns',''],['Size','size',' px'],['RowGap','rowGap','%'],['Density','density','%'],['Jitter','jitter','%'],['Margin','margin','%'],['Opacity','opacity','%'],['Dim','dim','%'],['Mono','mono','%'],['Grain','grain','%'],['Zoom','zoom','%'],['ClearWidth','clearWidth','%'],['ClearHeight','clearHeight','%']];
  const structural=new Set(['columns','size','rowGap','density','jitter','margin','font','unit']);
  let frame=0,loadId=0,drag=null,items=[],photoCache=null,layoutCache=null;
  let pendingLoad=null,videoSurface=null,grainTile=null,recording=null,lastVideoPaint=0;
  const video=()=>state.photo?.kind==='video'?state.photo.image:null;
  const dimensions=media=>({width:media.videoWidth||media.naturalWidth,height:media.videoHeight||media.naturalHeight});
  const active=()=>document.body.dataset.activeTool==='textField';
  const toast=m=>window.fieldStudyShell.showToast(m);
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(render);};
  function change(layout=false){state.dirty=true;state.preset='';if(layout){state.offsets={};state.selected=null;}schedule();}
  function font(size){return `${state.font==='sans'?700:400} ${size}px ${state.font==='serif'?'Georgia, serif':state.font==='mono'?'"Courier New", monospace':'Arial, sans-serif'}`;}
  function status(message,error=false){$('#textFieldStatus').className='process-status '+(error?'error':'ready');$('#textFieldStatusText').textContent=message;}
  function sync(){
    for(const [id,key,unit] of ranges){$('#textField'+id).value=state[key];$('#textField'+id+'Output').textContent=state[key]+unit;}
    for(const [id,key] of [['Text','text'],['Unit','unit'],['Font','font'],['Ink','ink'],['Color','color'],['Move','move'],['Fit','fit']])if($('#textField'+id).value!==String(state[key]))$('#textField'+id).value=state[key];
    $('#textFieldRepeat').checked=state.repeat;$('#textFieldClear').checked=state.clear;
    $('#textFieldClearControls').hidden=!state.clear;$('#textFieldMove').options[2].disabled=!state.clear;
    $('#textFieldColor').disabled=state.ink!=='custom';$('#textFieldColorOutput').textContent=state.color.toUpperCase();
    $('#textFieldBusy').hidden=!state.loading;$('#textFieldEmpty').hidden=Boolean(state.photo)||state.loading;
    $('#textFieldDemo').disabled=state.loading;$('#textFieldRemove').disabled=!state.photo||state.loading;
    $('#textFieldPreview').hidden=!state.photo;$('#textFieldIdle').hidden=Boolean(state.photo);
    for(const id of ['Fit','Zoom','CenterPhoto'])$('#textField'+id).disabled=!state.photo||state.loading;
    document.querySelectorAll('[data-tf-preset]').forEach(b=>{const active=b.dataset.tfPreset===state.preset;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
    if(document.body.dataset.activeTool==='textField')$('#fileNameHeader').textContent='TEXT FIELD';
    syncPlayback();syncSelection();
  }
  function syncSelection(){
    const item=items.find(x=>x.id===state.selected);
    $('#textFieldSelected').textContent=state.move==='photo'?'Source selected · drag to find your crop.':state.move==='clear'?'Clear area selected · drag the oval to leave space.':item?`Selected: “${item.text}” · drag or use arrow keys.`:'Click any word to select it, or use Next word.';
    $('#textFieldPrevious').disabled=$('#textFieldNext').disabled=!items.length;
    $('#textFieldHelp').textContent=state.move==='photo'?'Drag the source to reframe · choose Move a word to return.':state.move==='clear'?'Drag to position the clear area · resize it in Placement.':'Drag individual words · arrow keys nudge · Shift moves faster.';
  }
  function getLayout(logical){
    const key=JSON.stringify([logical,state.text,state.unit,state.repeat,state.columns,state.size,state.rowGap,state.density,state.jitter,state.margin,state.seed,state.font,state.clear,state.clearX,state.clearY,state.clearWidth,state.clearHeight,state.offsets]);
    if(layoutCache?.key===key)return layoutCache.value;
    const ctx=surface(1,1).getContext('2d');
    const value=E.layout({...state,...logical},(text,size)=>{ctx.font=font(size);return ctx.measureText(text).width;});
    layoutCache={key,value};return value;
  }
  function movingPhoto(w,h){
    if(!videoSurface||videoSurface.width!==w||videoSurface.height!==h)videoSurface=surface(w,h);
    const ctx=videoSurface.getContext('2d'),v=video(),r=E.fittedRect(v.videoWidth,v.videoHeight,w,h,state.zoom,state.photoX,state.photoY,state.fit);
    ctx.filter='none';ctx.fillStyle='#252922';ctx.fillRect(0,0,w,h);
    ctx.filter=`grayscale(${state.mono}%) brightness(${100-state.dim}%)`;
    ctx.drawImage(v,r.x,r.y,r.width,r.height);ctx.filter='none';
    if(state.grain){
      if(!grainTile){grainTile=surface(128,128);const c=grainTile.getContext('2d'),d=c.createImageData(128,128),random=E.random(91);for(let i=0;i<d.data.length;i+=4){const n=random();d.data[i]=d.data[i+1]=d.data[i+2]=n>.5?255:0;d.data[i+3]=Math.round(Math.abs(n-.5)*100);}c.putImageData(d,0,0);}
      ctx.save();const scale=Math.min(w,h)/900;ctx.scale(scale,scale);ctx.globalAlpha=state.grain/100;ctx.fillStyle=ctx.createPattern(grainTile,'repeat');ctx.fillRect(0,0,w/scale,h/scale);ctx.restore();
    }
    return videoSurface;
  }
  function getPhoto(w,h){
    if(video())return movingPhoto(w,h);
    const key=JSON.stringify([w,h,state.photo?.url,state.photoX,state.photoY,state.zoom,state.fit,state.mono,state.dim,state.grain]);
    if(photoCache?.key===key)return photoCache.surface;
    const out=surface(w,h),ctx=out.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#252922';ctx.fillRect(0,0,w,h);
    if(state.photo){const image=state.photo.image,r=E.fittedRect(image.naturalWidth,image.naturalHeight,w,h,state.zoom,state.photoX,state.photoY,state.fit);ctx.drawImage(image,r.x,r.y,r.width,r.height);}
    const pixels=ctx.getImageData(0,0,w,h),d=pixels.data,mix=state.mono/100,dim=1-state.dim/100,grain=state.grain*.28;
    const unit=Math.min(w,h)/900;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=(y*w+x)*4,lum=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];
      // Grain is anchored to logical photo coordinates, not export pixel count.
      let seed=(Math.floor(x/unit)*374761393+Math.floor(y/unit)*668265263)|0;seed=Math.imul(seed^(seed>>>13),1274126177);
      const noise=(((seed^(seed>>>16))>>>0)/4294967295-.5)*grain;
      for(let c=0;c<3;c++)d[i+c]=clamp((d[i+c]*(1-mix)+lum*mix)*dim+noise,0,255);
    }
    ctx.putImageData(pixels,0,0);photoCache={key,surface:out};return out;
  }
  function renderArt(target,w,h,logical){
    if(target.width!==w||target.height!==h){target.width=w;target.height=h;}const ctx=target.getContext('2d'),photo=getPhoto(w,h);ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;ctx.drawImage(photo,0,0);
    const layout=getLayout(logical),scale=w/logical.width;
    // A fixed-size sampling surface makes auto-ink choices independent of export size.
    let samplePixels=null;
    if(state.ink==='auto'){const probe=surface(180,Math.round(180*logical.height/logical.width));probe.getContext('2d').drawImage(photo,0,0,probe.width,probe.height);samplePixels={data:probe.getContext('2d').getImageData(0,0,probe.width,probe.height).data,width:probe.width,height:probe.height};}
    ctx.scale(scale,scale);ctx.textAlign='center';ctx.textBaseline='middle';ctx.globalAlpha=state.opacity/100;
    for(const b of layout.items){
      let ink=state.ink==='custom'?state.color:state.ink==='black'?'#171914':'#ffffff';
      if(samplePixels){let r=0,g=0,blue=0;for(const f of [.1,.3,.5,.7,.9]){const x=clamp(Math.floor((b.x+b.width*f)/logical.width*samplePixels.width),0,samplePixels.width-1),y=clamp(Math.floor((b.y+b.height/2)/logical.height*samplePixels.height),0,samplePixels.height-1),i=(y*samplePixels.width+x)*4;r+=samplePixels.data[i];g+=samplePixels.data[i+1];blue+=samplePixels.data[i+2];}ink=E.contrastColor(r/5,g/5,blue/5);}
      ctx.font=font(b.size);ctx.fillStyle=ink;
      ctx.shadowColor=ink==='#ffffff'?'#00000045':'#ffffff20';ctx.shadowBlur=.7*scale;ctx.shadowOffsetY=.45*scale;
      ctx.fillText(b.text,b.x+b.width/2,b.y+b.height/2);
    }
    return layout;
  }
  function render(now=performance.now()){
    frame=0;
    if(video()&&!video().paused&&now-lastVideoPaint<1000/30){schedule();return;}lastVideoPaint=now;const logical=window.outputFormat.logicalDimensions(),s=Math.min(1,1100/Math.max(logical.width,logical.height));
    const w=Math.round(logical.width*s),h=Math.round(logical.height*s);
    let result;
    if(recording){result=renderArt(recording.canvas,recording.width,recording.height,recording.logical);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}const c=canvas.getContext('2d');c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.shadowColor='transparent';c.drawImage(recording.canvas,0,0,w,h);}
    else result=renderArt(canvas,w,h,logical);
    items=result.items;
    if(!items.some(i=>i.id===state.selected))state.selected=null;
    window.outputFormat.applyShell($('#textFieldArtboardShell'));
    const d=window.outputFormat.dimensions(state.outputWidth);$('#textFieldDimensions').textContent=`${d.width} × ${d.height} PX`;
    let message=!result.total?'Add your words to start.':`${items.length} placements · ${result.used} of ${result.total} ${state.unit==='line'?'phrases':'words'} used`;
    if(result.used<result.total)message+=items.length===800?' · 800-placement limit; shorten your copy to fit.':' · reduce type size / row spacing or add columns to fit more.';
    else if(state.repeat&&items.length>result.total)message+=' · repeating';
    if(result.small)message+=' · long text fitted smaller; fewer columns gives it more room.';
    if($('#textFieldLayoutStatus').textContent!==message)$('#textFieldLayoutStatus').textContent=message;syncSelection();guide(logical);
    if(video()&&!video().paused&&(active()||state.recording)&&!document.hidden)schedule();
  }
  function guide(d=window.outputFormat.logicalDimensions()){
    const el=$('#textFieldGuide'),zone=state.move==='clear'&&state.clear;
    const b=zone?{x:(state.clearX-state.clearWidth/200)*d.width,y:(state.clearY-state.clearHeight/200)*d.height,width:state.clearWidth*d.width/100,height:state.clearHeight*d.height/100}:state.move==='photo'?{x:0,y:0,width:d.width,height:d.height}:items.find(i=>i.id===state.selected);
    el.hidden=!state.photo||!b||document.activeElement!==canvas;el.classList.toggle('zone',zone);
    if(b)Object.assign(el.style,{left:b.x/d.width*100+'%',top:b.y/d.height*100+'%',width:b.width/d.width*100+'%',height:b.height/d.height*100+'%'});
  }
  function dispose(source){
    if(!source)return;
    if(source.kind==='video'){source.image.pause();source.image.removeAttribute('src');source.image.load();source.image.remove();source.audio?.node.disconnect();source.audio?.context.close().catch(()=>{});}
    URL.revokeObjectURL(source.url);
  }
  function cancelLoad(){loadId++;pendingLoad?.();pendingLoad=null;}
  function setPhoto(image,url,name,kind='image'){
    dispose(state.photo);state.photo={image,url,name,kind};state.photoX=state.photoY=0;state.zoom=100;state.dirty=true;state.sound=false;state.playbackRate=1;photoCache=null;
    const d=dimensions(image);$('#textFieldThumb').hidden=kind==='video';$('#textFieldVideoSlot').hidden=kind!=='video';
    if(kind==='video'){
      image.hidden=false;$('#textFieldVideoSlot').replaceChildren(image);image.muted=true;image.loop=true;
      for(const event of ['play','pause','timeupdate','durationchange','ratechange'])image.addEventListener(event,()=>{if(video()!==image)return;syncPlayback();if(event==='play')schedule();});
      image.addEventListener('seeked',()=>{if(video()===image){syncPlayback();schedule();}});
      image.addEventListener('error',()=>{if(video()===image){status('Video playback failed. Try an H.264 MP4.',true);recording?.cancel('Video playback failed; recording cancelled.');}});
      if(active())image.play().catch(()=>{status('Video ready · press Play to preview.');syncPlayback();});
    }else $('#textFieldThumb').src=url;
    $('#textFieldSourceName').textContent=name;$('#textFieldSourceMeta').textContent=`${d.width} × ${d.height} · ${kind==='video'?formatTime(image.duration)+' · video':'image'} · local`;
    status(kind==='video'?'Video ready · plays on loop · sound starts off.':'Image ready · edit the words to make it yours.');
  }
  const loadImage=url=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This image could not be opened. Try JPG, PNG, or WebP.'));image.src=url;});
  function loadVideo(url){
    const v=document.createElement('video');Object.assign(v,{muted:true,loop:true,playsInline:true,preload:'auto',hidden:true});v.setAttribute('aria-label','Text Field source video');$('#textFieldVideoSlot').append(v);
    return new Promise((resolve,reject)=>{
      const clean=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',ready);v.removeEventListener('error',fail);pendingLoad=null;};
      const rejectVideo=message=>{clean();v.pause();v.removeAttribute('src');v.load();v.remove();reject(new Error(message));};
      const ready=()=>{if(!Number.isFinite(v.duration)||v.duration<=0||!v.videoWidth||!v.videoHeight){rejectVideo('Choose a finite video clip with a playable picture.');return;}clean();resolve(v);};
      const fail=()=>rejectVideo('This video could not be decoded. Try an H.264 MP4, WebM, or compatible MOV.');
      const timer=setTimeout(()=>rejectVideo('Video loading timed out. Try a smaller H.264 MP4.'),20000);
      pendingLoad=()=>rejectVideo('Video loading cancelled.');v.addEventListener('loadeddata',ready);v.addEventListener('error',fail);v.src=url;v.load();
    });
  }
  async function openFile(file){
    if(!file||state.recording)return;
    const isVideo=/^video\//i.test(file.type)||/\.(mp4|m4v|webm|mov)$/i.test(file.name);
    if(!isVideo&&!/^image\/(jpeg|png|webp)$/i.test(file.type)){toast('Choose a JPG, PNG, WebP, MP4, WebM, or MOV.');return;}
    const limit=isVideo?250:30;if(file.size>limit*1024*1024){toast(`Choose ${isVideo?'a video':'an image'} smaller than ${limit} MB.`);return;}
    cancelLoad();const id=loadId,url=URL.createObjectURL(file);state.loading=true;sync();let media=null,committed=false;
    try{media=await(isVideo?loadVideo(url):loadImage(url));if(id!==loadId)return;const d=dimensions(media);if(d.width*d.height>(isVideo?16e6:48e6))throw new Error(isVideo?'Resize this video below 16 megapixels per frame.':'Resize this image below 48 megapixels.');setPhoto(media,url,file.name,isVideo?'video':'image');committed=true;}
    catch(e){if(id===loadId){status(e.message,true);toast(e.message);}}
    finally{if(!committed){if(isVideo&&media){media.pause();media.removeAttribute('src');media.load();media.remove();}URL.revokeObjectURL(url);}if(id===loadId){state.loading=false;sync();schedule();}}
  }
  async function demo(){
    if(state.loading||state.recording)return;cancelLoad();const id=loadId;state.loading=true;sync();let url=null,committed=false;
    try{const plant=await loadImage('/frost-sample.svg');if(id!==loadId)return;const out=surface(900,1200),ctx=out.getContext('2d');ctx.fillStyle='#8b9580';ctx.fillRect(0,0,900,1200);ctx.drawImage(plant,0,0);const blob=await new Promise(resolve=>out.toBlob(resolve));if(!blob)throw new Error('Sample unavailable');url=URL.createObjectURL(blob);const image=await loadImage(url);if(id!==loadId)return;setPhoto(image,url,'Botanical sample');committed=true;status('Original botanical illustration · replace it with any photograph.');}
    catch(e){if(id===loadId)status('The sample could not be opened. Choose a photograph instead.',true);}
    finally{if(url&&!committed)URL.revokeObjectURL(url);if(id===loadId){state.loading=false;sync();schedule();}}
  }
  function preset(name){
    const configs={scatter:{unit:'word',columns:8,size:22,rowGap:205,jitter:78,density:87,font:'sans'},grid:{unit:'word',columns:7,size:21,rowGap:235,jitter:0,density:100,font:'mono'},verse:{unit:'line',columns:2,size:28,rowGap:320,jitter:45,density:80,font:'serif'}};
    Object.assign(state,configs[name],{offsets:{},selected:null,move:'word',preset:name,dirty:true});sync();schedule();
  }
  function reset(){if(state.recording)return;cancelLoad();if(video()){video().pause();video().currentTime=0;video().playbackRate=1;video().muted=true;}state.sound=false;state.playbackRate=1;Object.assign(state,defaults(),{loading:false,dirty:Boolean(state.photo)});photoCache=null;layoutCache=null;sync();schedule();status('Default words and spacing restored · your source is kept.');toast('Text Field reset. Your source is kept.');}
  function exportImage(type){
    if(state.recording)return;if(state.loading||!state.photo){toast('Add an image or video before exporting.');return;}
    const logical=type==='jpeg'?{width:900,height:900}:window.outputFormat.logicalDimensions(),size=type==='jpeg'?{width:3000,height:3000}:window.outputFormat.dimensions(state.outputWidth);
    try{const out=surface(size.width,size.height);renderArt(out,size.width,size.height,logical);
      const form=document.createElement('form');form.method='POST';form.action='/api/export';form.target='fieldStudyDownload';form.hidden=true;
      for(const [name,value] of [['image',out.toDataURL('image/'+type,.95)],['filename',`text-field-${size.width}x${size.height}.${type==='jpeg'?'jpg':'png'}`]]){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);}document.body.append(form);form.submit();requestAnimationFrame(()=>form.remove());toast(`${type==='jpeg'?'JPEG':'PNG'} exported · ${size.width} × ${size.height}`);
    }catch(e){toast('This image could not be exported. Try the standard PNG size.');}
    finally{photoCache=null;layoutCache=null;schedule();}
  }
  function point(event){const r=canvas.getBoundingClientRect(),d=window.outputFormat.logicalDimensions();return{x:(event.clientX-r.left)/r.width*d.width,y:(event.clientY-r.top)/r.height*d.height};}
  function move(dx,dy){
    const d=window.outputFormat.logicalDimensions();
    if(state.move==='photo'){state.photoX=clamp(state.photoX+dx/d.width,-1,1);state.photoY=clamp(state.photoY+dy/d.height,-1,1);}
    else if(state.move==='clear'){state.clearX=clamp(state.clearX+dx/d.width,state.clearWidth/200,1-state.clearWidth/200);state.clearY=clamp(state.clearY+dy/d.height,state.clearHeight/200,1-state.clearHeight/200);state.offsets={};}
    else{const b=items.find(i=>i.id===state.selected);if(!b)return;const margin=Math.min(d.width,d.height)*state.margin/100,offset=state.offsets[b.id]||{x:0,y:0};state.offsets[b.id]={x:offset.x+(clamp(b.x+dx,margin,d.width-margin-b.width)-b.x)/d.width,y:offset.y+(clamp(b.y+dy,margin,d.height-margin-b.height)-b.y)/d.height};}
    state.dirty=true;schedule();
  }
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0||state.loading||state.recording||!state.photo)return;const p=point(e);
    if(state.move==='word'){const hit=[...items].reverse().find(b=>p.x>=b.x-6&&p.x<=b.x+b.width+6&&p.y>=b.y-5&&p.y<=b.y+b.height+5);if(!hit){state.selected=null;guide();syncSelection();return;}state.selected=hit.id;}
    e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);drag={id:e.pointerId,p};syncSelection();guide();
  });
  canvas.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const p=point(e);move(p.x-drag.p.x,p.y-drag.p.y);drag.p=p;});
  const end=e=>{if(drag?.id===e.pointerId){drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}};
  ['pointerup','pointercancel','lostpointercapture'].forEach(t=>canvas.addEventListener(t,end));
  canvas.addEventListener('focus',()=>guide());canvas.addEventListener('blur',()=>guide());
  canvas.addEventListener('keydown',e=>{if(e.key==='Escape'){state.selected=null;syncSelection();guide();return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||state.loading||state.recording||!state.photo)return;e.preventDefault();const step=e.shiftKey?10:1;move(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0);});
  for(const [id,key] of ranges)$('#textField'+id).addEventListener('input',e=>{state[key]=Number(e.target.value);change(structural.has(key)||key.startsWith('clear'));sync();});
  for(const [id,key] of [['Unit','unit'],['Font','font'],['Ink','ink'],['Fit','fit']])$('#textField'+id).addEventListener('change',e=>{state[key]=e.target.value;change(structural.has(key));sync();});
  $('#textFieldText').addEventListener('input',e=>{state.text=e.target.value;change(true);});
  $('#textFieldRepeat').addEventListener('change',e=>{state.repeat=e.target.checked;change(true);sync();});
  $('#textFieldClear').addEventListener('change',e=>{state.clear=e.target.checked;if(!state.clear&&state.move==='clear')state.move='word';change(true);sync();});
  $('#textFieldMove').addEventListener('change',e=>{state.move=e.target.value;sync();canvas.focus();guide();});
  $('#textFieldColor').addEventListener('input',e=>{state.color=e.target.value;change();sync();});
  $('#textFieldReroll').addEventListener('click',()=>{state.seed++;change(true);sync();});
  $('#textFieldResetWords').addEventListener('click',()=>{state.offsets={};state.selected=null;change();sync();});
  $('#textFieldCenterPhoto').addEventListener('click',()=>{state.photoX=state.photoY=0;state.zoom=100;change();sync();});
  $('#textFieldCenterClear').addEventListener('click',()=>{state.clearX=state.clearY=.5;change(true);sync();});
  $('#textFieldMoveClear').addEventListener('click',()=>{state.move='clear';sync();canvas.focus();guide();});
  for(const [id,step] of [['Previous',-1],['Next',1]])$('#textField'+id).addEventListener('click',()=>{if(!items.length)return;let i=items.findIndex(b=>b.id===state.selected);if(i<0)i=step===1?-1:0;state.selected=items[(i+step+items.length)%items.length].id;state.move='word';sync();canvas.focus();guide();});
  document.querySelectorAll('[data-tf-preset]').forEach(b=>b.addEventListener('click',()=>preset(b.dataset.tfPreset)));
  $('#textFieldInput').addEventListener('change',e=>{openFile(e.target.files[0]);e.target.value='';});
  for(const type of ['dragenter','dragover','dragleave','drop'])$('#textFieldDrop').addEventListener(type,e=>{e.preventDefault();$('#textFieldDrop').classList.toggle('dragover',type==='dragenter'||type==='dragover');if(type==='drop')openFile(e.dataTransfer.files[0]);});
  ['Demo','EmptyDemo'].forEach(id=>$('#textField'+id).addEventListener('click',demo));
  $('#textFieldEmptyChoose').addEventListener('click',()=>$('#textFieldInput').click());
  $('#textFieldRemove').addEventListener('click',()=>{if(state.loading||state.recording)return;dispose(state.photo);state.photo=null;state.sound=false;photoCache=null;$('#textFieldThumb').removeAttribute('src');change();sync();status('Source removed · your words are kept.');});
  function formatTime(n){n=Math.max(0,Math.floor(Number(n)||0));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
  function syncPlayback(){
    const v=video();$('#textFieldPlayback').hidden=!v;if(!v)return;
    const playing=!v.paused;$('#textFieldPlay').classList.toggle('playing',playing);$('#textFieldPlay').setAttribute('aria-pressed',String(playing));$('#textFieldPlay span').textContent=playing?'Pause':'Play';
    $('#textFieldPlayhead').max=String(v.duration||1);if(!v.seeking)$('#textFieldPlayhead').value=String(v.currentTime||0);
    $('#textFieldTime').textContent=`${formatTime(v.currentTime)} / ${formatTime(v.duration)}`;
    $('#textFieldSpeed').value=String(state.playbackRate);$('#textFieldSound').setAttribute('aria-pressed',String(state.sound));$('#textFieldSound').setAttribute('aria-label',state.sound?'Turn video sound off':'Turn video sound on');
  }
  function recordingFormat(){
    if(!window.MediaRecorder||!canvas.captureStream)return null;
    return [{mimeType:'video/mp4',extension:'mp4',label:'MP4'},{mimeType:'video/webm;codecs=vp9,opus',extension:'webm',label:'WebM'},{mimeType:'video/webm',extension:'webm',label:'WebM'}].find(f=>MediaRecorder.isTypeSupported(f.mimeType))||null;
  }
  async function recordingAudio(){
    // A media-element source also works in browsers without video.captureStream().
    const source=state.photo,Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)throw new Error('Sound export is unavailable here. Turn sound off to export a silent video.');
    if(!source.audio){const context=new Context();let node;try{node=context.createMediaElementSource(source.image);node.connect(context.destination);}catch(e){context.close();throw e;}source.audio={context,node};}
    await source.audio.context.resume();return source.audio;
  }
  function seekTo(v,time){return new Promise(resolve=>{if(Math.abs(v.currentTime-time)<.01&&!v.seeking){resolve();return;}let timer;const done=()=>{clearTimeout(timer);v.removeEventListener('seeked',done);resolve();};v.addEventListener('seeked',done,{once:true});timer=setTimeout(done,1500);v.currentTime=clamp(time,0,Math.max(0,v.duration-.001));});}
  async function exportAnimated(){
    const v=video(),format=recordingFormat();if(!v||state.loading||state.recording)return;
    if(!format){toast('This browser cannot record video. You can still export a frame.');return;}
    const duration=state.clipDuration,snapshot={time:v.currentTime,paused:v.paused},logical=window.outputFormat.logicalDimensions(),size=window.outputFormat.dimensions(state.outputWidth);
    const session={canvas:surface(size.width,size.height),...size,logical,cancelReason:'',cancel(reason='Recording cancelled.'){session.cancelReason=reason;if(recorder?.state==='recording')recorder.stop();}};
    let recorder=null,stream=null,destination=null,audio=null,stopTimer=null,progressTimer=null,completed=null;
    const locks=[...document.querySelectorAll('[data-tool-switch], #outputFormatButton, #resetButton, #exportButton')].map(el=>({el,disabled:el.disabled}));
    const rail=$('#textFieldStudio .control-rail'),wasInert=rail.inert;
    try{
      state.recording=true;recording=session;v.pause();rail.inert=true;locks.forEach(({el})=>el.disabled=true);$('#textFieldRecording').hidden=false;$('#textFieldRecordingStatus').textContent=`Preparing ${duration}s ${format.label}…`;$('#textFieldCancelRecording').focus();
      if(state.sound){audio=await recordingAudio();destination=audio.context.createMediaStreamDestination();audio.node.connect(destination);}
      if(session.cancelReason)throw new Error(session.cancelReason);
      renderArt(session.canvas,size.width,size.height,logical);stream=session.canvas.captureStream(30);
      if(destination)destination.stream.getAudioTracks().forEach(track=>stream.addTrack(track));
      recorder=new MediaRecorder(stream,{mimeType:format.mimeType,videoBitsPerSecond:8_000_000,audioBitsPerSecond:192000});const chunks=[];
      completed=new Promise((resolve,reject)=>{recorder.addEventListener('dataavailable',e=>{if(e.data?.size)chunks.push(e.data);});recorder.addEventListener('stop',()=>resolve(new Blob(chunks,{type:recorder.mimeType||format.mimeType})),{once:true});recorder.addEventListener('error',()=>reject(new Error('The video recorder failed. Try standard size or a shorter clip.')),{once:true});});
      // Attach a rejection handler before awaiting playback, which can fail independently.
      completed.catch(()=>{});recorder.start(250);await v.play();schedule();
      const start=performance.now();$('#textFieldRecordingStatus').textContent=`Recording 0 / ${duration}s`;
      progressTimer=setInterval(()=>{$('#textFieldRecordingStatus').textContent=`Recording ${Math.min(duration,(performance.now()-start)/1000).toFixed(1)} / ${duration}s`;},250);
      stopTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},duration*1000);
      const blob=await completed;if(session.cancelReason)throw new Error(session.cancelReason);if(!blob.size)throw new Error('The browser returned an empty recording.');
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`text-field-${size.width}x${size.height}-${duration}s.${format.extension}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      toast(`${duration}s ${format.label} exported · ${size.width} × ${size.height}${state.sound?' · sound on':' · silent'}`);
    }catch(e){toast(e.message||'Video export failed. Try standard size or a shorter clip.');}
    finally{
      clearTimeout(stopTimer);clearInterval(progressTimer);
      if(recorder?.state==='recording')recorder.stop();
      if(completed)await completed.catch(()=>{});
      stream?.getTracks().forEach(track=>track.stop());if(audio&&destination)audio.node.disconnect(destination);
      v.pause();recording=null;state.recording=false;rail.inert=wasInert;locks.forEach(({el,disabled})=>el.disabled=disabled);$('#textFieldRecording').hidden=true;
      await seekTo(v,snapshot.time);if(!snapshot.paused&&active()&&!document.hidden)v.play().catch(()=>{});
      syncPlayback();schedule();if(active())$('#exportButton').focus();
    }
  }
  $('#textFieldPlay').addEventListener('click',async()=>{const v=video();if(!v||state.recording)return;if(v.paused){try{await state.photo.audio?.context.resume();await v.play();schedule();}catch(e){toast('Playback could not start. Try reloading this video.');}}else v.pause();syncPlayback();});
  $('#textFieldPlayhead').addEventListener('input',e=>{const v=video();if(!v||state.recording)return;v.pause();v.currentTime=clamp(Number(e.target.value),0,Math.max(0,v.duration-.001));syncPlayback();});
  $('#textFieldSpeed').addEventListener('change',e=>{if(!video()||state.recording)return;state.playbackRate=Number(e.target.value);video().playbackRate=state.playbackRate;syncPlayback();});
  $('#textFieldSound').addEventListener('click',async()=>{const v=video();if(!v||state.recording)return;state.sound=!state.sound;v.muted=!state.sound;if(state.sound)await state.photo.audio?.context.resume();syncPlayback();});
  $('#textFieldCancelRecording').addEventListener('click',()=>recording?.cancel());
  document.addEventListener('visibilitychange',()=>{if(document.hidden){recording?.cancel('Recording cancelled because this tab was hidden. Keep it visible while exporting.');video()?.pause();}});

  window.textField={activate(){sync();schedule();},deactivate(){if(state.recording)recording?.cancel('Recording cancelled when leaving Text Field.');video()?.pause();},refreshFormat(){state.selected=null;schedule();},reset,hasContent:()=>Boolean(state.photo||state.dirty),getExportOptions:()=>({canExport:Boolean(state.photo)&&!state.loading,motionAvailable:Boolean(video()&&recordingFormat()),outputWidth:state.outputWidth,recording:state.recording,clipDuration:state.clipDuration,format:recordingFormat(),soundAvailable:Boolean(video()),audioEnabled:Boolean(video()&&state.sound)}),setClipDuration(n){state.clipDuration=clamp(Math.round(Number(n)||10),3,60);},exportAnimated,setOutputWidth(n){state.outputWidth=[900,1350,3000].includes(Number(n))?Number(n):900;schedule();},exportPng:()=>exportImage('png'),exportJpeg:()=>exportImage('jpeg')};
  sync();render();
})();
