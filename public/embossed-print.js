(() => {
  'use strict';
  const $=s=>document.querySelector(s),canvas=$('#embossCanvas');if(!canvas)return;
  const E=window.EmbossEngine,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const surface=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
  const fonts={serif:'Georgia, "Times New Roman", serif',sans:'"Helvetica Neue", Arial, sans-serif',bold:'Arial, sans-serif',mono:'"Courier New", monospace'};
  const defaults=()=>({paper:'#70afd1',relief:'deboss',depth:42,bevel:45,strength:80,angle:315,wash:65,grain:65,seed:19,preset:'blue',layout:'none',split:34,photoMono:0,photoContrast:0,photoGrain:28,photoZoom:100,photoX:0,photoY:0,photoFit:'cover'});
  const defaultLayers=()=>[
    {id:'title',label:'Title',text:'AFTERLIGHT',font:'serif',leading:125,size:88,tracking:9,x:.5,y:.25,align:'center'},
    {id:'subtitle',label:'Subtitle',text:'SOUND, SPACE & THE ART\nOF PAYING ATTENTION',font:'serif',leading:125,size:28,tracking:2,x:.5,y:.54,align:'center'},
    {id:'footer',label:'Edition',text:'A FIELD/STUDY EDITION\nVOLUME 01 — 2026',font:'serif',leading:125,size:23,tracking:2,x:.5,y:.89,align:'center'}
  ];
  const state={...defaults(),layers:defaultLayers(),selected:'title',move:'type',photo:null,palette:[],loading:false,outputWidth:window.outputFormat.get().shortEdge,dirty:false,copyEdited:false};
  let frame=0,loadId=0,maskCache=null,photoCache=null,bounds=[],drag=null;
  const selected=()=>state.layers.find(l=>l.id===state.selected);
  const toast=m=>window.fieldStudyShell.showToast(m);
  const invalidate=()=>{maskCache=null;photoCache=null;};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(render);};
  const dirty=()=>{state.dirty=true;state.preset='';document.querySelectorAll('[data-emboss-preset]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');});schedule();};
  const loadImage=url=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This image could not be opened. Try JPG, PNG, or WebP.'));image.src=url;});
  function status(message,error=false){$('#embossStatus').className='process-status '+(error?'error':'ready');$('#embossStatusText').textContent=message;}
  function effectiveLayout(){return state.photo?state.layout:'none';}
  function syncPhoto(){
    $('#embossSourcePreview').hidden=!state.photo;$('#embossSourceIdle').hidden=Boolean(state.photo);
    if(state.photo){$('#embossThumb').src=state.photo.url;$('#embossSourceName').textContent=state.photo.name;$('#embossSourceMeta').textContent=`${state.photo.image.naturalWidth} × ${state.photo.image.naturalHeight} · local`;}
    else $('#embossThumb').removeAttribute('src');
  }
  function sync(){
    const layer=selected();
    for(const [id,key,unit] of [['Depth','depth','%'],['Bevel','bevel','%'],['Strength','strength','%'],['Angle','angle','°'],['Wash','wash','%'],['Grain','grain','%'],['Split','split','%'],['PhotoMono','photoMono','%'],['PhotoContrast','photoContrast','%'],['PhotoGrain','photoGrain','%'],['PhotoZoom','photoZoom','%']]){
      $('#emboss'+id).value=state[key];$('#emboss'+id+'Output').textContent=state[key]+unit;
    }
    for(const [id,key,unit] of [['Size','size',' px'],['Tracking','tracking',' px'],['Leading','leading','%']]){$('#emboss'+id).value=layer[key];$('#emboss'+id+'Output').textContent=layer[key]+unit;}
    $('#embossTextLabel').textContent=layer.label+' text';if($('#embossText').value!==layer.text)$('#embossText').value=layer.text;
    $('#embossFont').value=layer.font;$('#embossAlign').value=layer.align;
    $('#embossRelief').value=state.relief;$('#embossLayout').value=state.layout;$('#embossMove').value=state.move;$('#embossPhotoFit').value=state.photoFit;
    $('#embossPaper').value=state.paper;$('#embossPaperOutput').textContent=state.paper.toUpperCase();
    $('#embossBusy').hidden=!state.loading;$('#embossDemo').disabled=state.loading;$('#embossRemove').disabled=!state.photo||state.loading;
    $('#embossMove').options[1].disabled=!state.photo||state.layout==='none';
    for(const id of ['Split','PhotoMono','PhotoContrast','PhotoGrain','PhotoZoom','PhotoFit','PhotoCenter'])$('#emboss'+id).disabled=!state.photo||state.loading;
    document.querySelectorAll('[data-emboss-layer]').forEach(b=>{const active=b.dataset.embossLayer===state.selected;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
    document.querySelectorAll('[data-emboss-preset]').forEach(b=>{const active=b.dataset.embossPreset===state.preset;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
    $('#embossHelp').textContent=state.move==='photo'?'Photograph selected · drag to reframe · click lettering to switch.':`${layer.label} selected · drag lettering to arrange it · drag the photograph to reframe.`;
    window.projectPalette.render($('#embossPalette'),state.palette,color=>{state.paper=color;invalidate();dirty();sync();},state.paper);
    if(document.body.dataset.activeTool==='emboss')$('#fileNameHeader').textContent='EMBOSSED PRINT';
  }
  function textWidth(ctx,text,tracking){const chars=Array.from(text);return (tracking?chars.reduce((sum,c)=>sum+ctx.measureText(c).width,0):ctx.measureText(text).width)+Math.max(0,chars.length-1)*tracking;}
  function linesFor(ctx,text,tracking,maxWidth){
    const lines=[];
    for(const paragraph of text.split('\n')){
      if(!paragraph){lines.push('');continue;}
      let line='';for(const word of paragraph.split(/\s+/)){const test=line?line+' '+word:word;if(line&&textWidth(ctx,test,tracking)>maxWidth){lines.push(line);line=word;}else line=test;}
      lines.push(line);
    }
    return lines;
  }
  function drawLetters(ctx,text,x,y,tracking){
    if(!tracking){ctx.fillText(text,x,y);return;}
    for(const char of Array.from(text)){ctx.fillText(char,x,y);x+=ctx.measureText(char).width+tracking;}
  }
  function getMask(width,height,logical){
    const key=JSON.stringify([width,height,logical,state.layers,effectiveLayout(),state.split,state.bevel]);
    if(maskCache?.key===key)return maskCache;
    const mask=surface(width,height),ctx=mask.getContext('2d',{willReadFrequently:true}),unit=width/logical.width,p=E.panel(logical.width,logical.height,effectiveLayout(),state.split).paper;
    const short=Math.min(logical.width,logical.height)/900,layerBounds=[],field=new Float32Array(width*height);
    ctx.scale(unit,unit);ctx.beginPath();ctx.rect(p.x,p.y,p.width,p.height);ctx.clip();ctx.fillStyle='white';ctx.textBaseline='middle';ctx.textAlign='left';
    for(const layer of state.layers){
      if(!layer.text.trim())continue;
      ctx.clearRect(0,0,logical.width,logical.height);
      const size=layer.size*short,tracking=layer.tracking*short;
      ctx.font=`${layer.font==='bold'?900:400} ${size}px ${fonts[layer.font]}`;
      const lines=linesFor(ctx,layer.text,tracking,p.width*.86),naturalWidth=Math.max(1,...lines.map(t=>textWidth(ctx,t,tracking)));
      const fit=Math.min(1,p.width*.88/naturalWidth,p.height*.75/(lines.length*size*layer.leading/100));
      const leading=size*layer.leading/100,blockHeight=lines.length*leading*fit,blockWidth=naturalWidth*fit;
      const cx=p.x+layer.x*p.width,cy=p.y+layer.y*p.height;
      // Alignment justifies lines inside the block; its canvas position stays fixed.
      const left=cx-blockWidth/2;
      layerBounds.push({id:layer.id,x:left,y:cy-blockHeight/2,width:blockWidth,height:blockHeight});
      ctx.save();ctx.translate(left,cy-blockHeight/2);ctx.scale(fit,fit);
      lines.forEach((line,i)=>{const lw=textWidth(ctx,line,tracking),x=layer.align==='left'?0:layer.align==='right'?naturalWidth-lw:(naturalWidth-lw)/2;drawLetters(ctx,line,x,(i+.5)*leading,tracking);});ctx.restore();
      // Small glyphs need narrower, shallower edges to keep their counters open.
      // Process only the block's crop, avoiding multiple full-page blur buffers.
      const detail=E.letteringScale(layer.size*fit),pad=(12+size*.25)*unit;
      const x0=Math.max(0,Math.floor(left*unit-pad)),y0=Math.max(0,Math.floor((cy-blockHeight/2)*unit-pad));
      const x1=Math.min(width,Math.ceil((left+blockWidth)*unit+pad)),y1=Math.min(height,Math.ceil((cy+blockHeight/2)*unit+pad));
      const cropWidth=x1-x0,cropHeight=y1-y0;
      if(cropWidth>0&&cropHeight>0){
        const alpha=ctx.getImageData(x0,y0,cropWidth,cropHeight).data;
        const local=E.heightField(alpha,cropWidth,cropHeight,state.bevel,Math.min(width,height)/900*detail);
        for(let y=0;y<cropHeight;y++)for(let x=0;x<cropWidth;x++){
          const dest=(y0+y)*width+x0+x;
          field[dest]=Math.max(field[dest],local[y*cropWidth+x]*detail);
        }
      }
    }
    maskCache={key,field,bounds:layerBounds};return maskCache;
  }
  function getPhoto(width,height){
    if(!state.photo||state.layout==='none')return null;
    const key=JSON.stringify([state.photo.url,width,height,state.layout,state.split,state.photoFit,state.photoZoom,state.photoX,state.photoY,state.paper]);
    if(photoCache?.key===key)return photoCache.surface;
    const target=surface(width,height),ctx=target.getContext('2d'),region=E.panel(width,height,state.layout,state.split).photo;
    ctx.fillStyle=state.paper;ctx.fillRect(0,0,width,height);
    const r=E.fittedRect(state.photo.image.naturalWidth,state.photo.image.naturalHeight,region,state.photoZoom,state.photoX,state.photoY,state.photoFit);
    ctx.save();ctx.beginPath();ctx.rect(region.x,region.y,region.width,region.height);ctx.clip();ctx.drawImage(state.photo.image,r.x,r.y,r.width,r.height);ctx.restore();
    photoCache={key,surface:target};return target;
  }
  function renderArt(target,width,height,logical){
    target.width=width;target.height=height;const ctx=target.getContext('2d',{willReadFrequently:true});
    const photo=getPhoto(width,height);if(photo)ctx.drawImage(photo,0,0);else{ctx.fillStyle=state.paper;ctx.fillRect(0,0,width,height);}
    const mask=getMask(width,height,logical),regions=E.panel(width,height,effectiveLayout(),state.split),unit=Math.min(width,height)/900;
    const pixels=ctx.getImageData(0,0,width,height);
    E.shade(pixels.data,width,height,mask.field,state,regions.paper,unit);
    if(regions.photo)E.photoTreatment(pixels.data,width,height,regions.photo,state,unit);
    ctx.putImageData(pixels,0,0);return mask.bounds;
  }
  function render(){
    frame=0;const logical=window.outputFormat.logicalDimensions(),scale=Math.min(1,1000/Math.max(logical.width,logical.height));
    bounds=renderArt(canvas,Math.round(logical.width*scale),Math.round(logical.height*scale),logical);
    window.outputFormat.applyShell($('#embossArtboardShell'));
    const dimensions=window.outputFormat.dimensions(state.outputWidth);$('#embossDimensions').textContent=`${dimensions.width} × ${dimensions.height} PX`;
    $('#embossModeLabel').textContent=state.relief==='deboss'?'RECESSED LETTERING':'RAISED LETTERING';updateGuide(logical);
  }
  function updateGuide(logical=window.outputFormat.logicalDimensions()){
    const b=state.move==='photo'?E.panel(logical.width,logical.height,effectiveLayout(),state.split).photo:bounds.find(b=>b.id===state.selected),guide=$('#embossSelection');
    guide.hidden=!b||document.activeElement!==canvas;
    if(b)Object.assign(guide.style,{left:b.x/logical.width*100+'%',top:b.y/logical.height*100+'%',width:b.width/logical.width*100+'%',height:b.height/logical.height*100+'%'});
  }
  function applyPreset(name){
    const style={blue:{paper:'#70afd1',relief:'deboss',depth:42,bevel:45,strength:80,wash:65,grain:65,layout:'none'},red:{paper:'#df1c19',relief:'emboss',depth:57,bevel:34,strength:90,wash:18,grain:58,layout:'top'},natural:{paper:'#e7dfcc',relief:'deboss',depth:52,bevel:35,strength:78,wash:25,grain:76,layout:'none'}}[name];
    Object.assign(state,style,{preset:name,angle:315,split:34,move:'type',dirty:true});
    const baseline=defaultLayers();
    if(!state.copyEdited)state.layers.forEach((layer,i)=>{layer.text=name==='red'?['soft\nsignal','STUDIES IN SOUND & IMAGE','VOLUME 01 — 2026'][i]:baseline[i].text;});
    state.layers.forEach((layer,i)=>{
      const text=layer.text;Object.assign(layer,baseline[i],{text});
      if(name==='red')Object.assign(layer,{font:i===0?'bold':'sans',size:[148,22,19][i],leading:i===0?95:125,tracking:[-3,1,2][i],y:[.40,.70,.91][i]});
      if(name==='natural')Object.assign(layer,{font:i===0?'serif':'mono',tracking:i===0?2:1});
    });
    if(name==='red')Object.assign(state,{photoMono:100,photoContrast:14,photoGrain:52});
    invalidate();sync();schedule();
    if(name==='red'&&!state.photo)$('#embossPhotoSection').open=true;
    status(name==='red'&&!state.photo?'Red sleeve ready · add a photo or try the botanical sample to fill the top panel.':'Preset applied · your text and photograph are kept.');
  }
  function setPhoto(image,url,name){
    if(state.photo)URL.revokeObjectURL(state.photo.url);state.photo={image,url,name};state.photoX=state.photoY=0;state.photoZoom=100;
    if(state.layout==='none')state.layout='top';state.dirty=true;invalidate();syncPhoto();
    state.palette=window.projectPalette.extract(image,8);
    status('Photograph ready · drag directly on the photo panel to adjust the crop.');
  }
  async function openFile(file){
    if(!file)return;if(!/^image\/(jpeg|png|webp)$/i.test(file.type)){toast('Choose a JPG, PNG, or WebP image.');return;}
    if(file.size>30*1024*1024){toast('Choose an image smaller than 30 MB.');return;}
    const id=++loadId,url=URL.createObjectURL(file);state.loading=true;sync();
    try{const image=await loadImage(url);if(id!==loadId){URL.revokeObjectURL(url);return;}if(image.naturalWidth*image.naturalHeight>48e6)throw new Error('Resize this photograph below 48 megapixels before opening it.');setPhoto(image,url,file.name);}
    catch(e){URL.revokeObjectURL(url);if(id===loadId){status(e.message,true);toast(e.message);}}
    finally{if(id===loadId){state.loading=false;sync();schedule();}}
  }
  async function demo(){
    if(state.loading)return;const id=++loadId;state.loading=true;sync();let url=null,committed=false;
    try{
      const plant=await loadImage('/frost-sample.svg');if(id!==loadId)return;
      const c=surface(900,1200),ctx=c.getContext('2d');ctx.fillStyle='#ded8cb';ctx.fillRect(0,0,900,1200);ctx.drawImage(plant,0,0);
      const blob=await new Promise(resolve=>c.toBlob(resolve));if(!blob)throw new Error('The sample could not be opened.');url=URL.createObjectURL(blob);
      const image=await loadImage(url);if(id!==loadId)return;setPhoto(image,url,'Botanical sample');committed=true;
      status('Illustrated botanical sample · replace with your photograph.');
    }catch(e){if(id===loadId)status('The sample could not be opened. Choose a photograph instead.',true);}
    finally{if(url&&!committed)URL.revokeObjectURL(url);if(id===loadId){state.loading=false;sync();schedule();}}
  }
  function reset(){
    loadId++;const hasPhoto=Boolean(state.photo);Object.assign(state,defaults(),{layers:defaultLayers(),selected:'title',move:'type',loading:false,dirty:hasPhoto,copyEdited:false});
    invalidate();sync();schedule();status(hasPhoto?'Settings reset · your photo is kept. Choose a panel layout to show it.':'Blue book restored · edit the title to make it yours.');toast('Embossed Print reset. Your photograph is kept.');
  }
  function exportImage(type){
    if(state.loading){toast('Wait for the photograph to finish opening.');return;}
    const logical=type==='jpeg'?{width:900,height:900}:window.outputFormat.logicalDimensions(),size=type==='jpeg'?{width:3000,height:3000}:window.outputFormat.dimensions(state.outputWidth);
    try{
      const out=surface(size.width,size.height);renderArt(out,size.width,size.height,logical);
      const title=state.layers[0].text.trim().replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,45)||'embossed-print';
      const filename=`${title}-${size.width}x${size.height}.${type==='jpeg'?'jpg':'png'}`;
      const form=document.createElement('form');form.method='POST';form.action='/api/export';form.target='fieldStudyDownload';form.hidden=true;
      for(const [name,value] of [['image',out.toDataURL('image/'+type,.95)],['filename',filename]]){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);}
      document.body.append(form);form.submit();requestAnimationFrame(()=>form.remove());toast(`${type==='jpeg'?'JPEG':'PNG'} exported · ${size.width} × ${size.height}`);
    }catch(e){toast('This image could not be exported. Try the standard PNG size.');}
    finally{invalidate();schedule();}
  }
  function point(event){const r=canvas.getBoundingClientRect(),d=window.outputFormat.logicalDimensions();return {x:(event.clientX-r.left)/r.width*d.width,y:(event.clientY-r.top)/r.height*d.height};}
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0||state.loading)return;const p=point(event),d=window.outputFormat.logicalDimensions(),regions=E.panel(d.width,d.height,effectiveLayout(),state.split);
    const hit=[...bounds].reverse().find(b=>p.x>=b.x-10&&p.x<=b.x+b.width+10&&p.y>=b.y-10&&p.y<=b.y+b.height+10);
    const photo=regions.photo;
    const inPhoto=photo&&p.x>=photo.x&&p.y>=photo.y&&p.x<=photo.x+photo.width&&p.y<=photo.y+photo.height;
    if(inPhoto)state.move='photo';
    else if(hit){state.selected=hit.id;state.move='type';}
    else return;
    sync();
    event.preventDefault();canvas.focus();canvas.setPointerCapture(event.pointerId);drag={id:event.pointerId,p,region:state.move==='photo'?regions.photo:regions.paper,mode:state.move};updateGuide();
  });
  canvas.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;const p=point(event),dx=(p.x-drag.p.x)/drag.region.width,dy=(p.y-drag.p.y)/drag.region.height;
    if(drag.mode==='photo'){state.photoX=clamp(state.photoX+dx,-1,1);state.photoY=clamp(state.photoY+dy,-1,1);}else{selected().x=clamp(selected().x+dx,0,1);selected().y=clamp(selected().y+dy,0,1);}
    drag.p=p;dirty();
  });
  const endDrag=e=>{if(drag?.id===e.pointerId){drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}};
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>canvas.addEventListener(type,endDrag));
  canvas.addEventListener('focus',()=>updateGuide());canvas.addEventListener('blur',()=>updateGuide());
  canvas.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||state.loading)return;event.preventDefault();
    const d=window.outputFormat.logicalDimensions(),regions=E.panel(d.width,d.height,effectiveLayout(),state.split),r=state.move==='photo'?regions.photo:regions.paper;if(!r)return;
    const step=event.shiftKey?10:1,dx=(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0)/r.width,dy=(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)/r.height;
    if(state.move==='photo'){state.photoX=clamp(state.photoX+dx,-1,1);state.photoY=clamp(state.photoY+dy,-1,1);}else{selected().x=clamp(selected().x+dx,0,1);selected().y=clamp(selected().y+dy,0,1);}dirty();
  });
  document.querySelectorAll('[data-emboss-preset]').forEach(b=>b.addEventListener('click',()=>applyPreset(b.dataset.embossPreset)));
  document.querySelectorAll('[data-emboss-layer]').forEach(b=>b.addEventListener('click',()=>{state.selected=b.dataset.embossLayer;state.move='type';sync();schedule();}));
  $('#embossText').addEventListener('input',e=>{selected().text=e.target.value;state.copyEdited=true;dirty();});
  for(const [id,key] of [['Font','font'],['Align','align']])$('#emboss'+id).addEventListener('change',e=>{selected()[key]=e.target.value;dirty();});
  for(const [id,key] of [['Size','size'],['Tracking','tracking'],['Leading','leading']])$('#emboss'+id).addEventListener('input',e=>{selected()[key]=Number(e.target.value);dirty();sync();});
  $('#embossTextCenter').addEventListener('click',()=>{selected().x=.5;dirty();sync();});
  for(const [id,key] of [['Depth','depth'],['Bevel','bevel'],['Strength','strength'],['Angle','angle'],['Wash','wash'],['Grain','grain'],['Split','split'],['PhotoMono','photoMono'],['PhotoContrast','photoContrast'],['PhotoGrain','photoGrain'],['PhotoZoom','photoZoom']])$('#emboss'+id).addEventListener('input',e=>{state[key]=Number(e.target.value);dirty();sync();});
  for(const [id,key] of [['Relief','relief'],['Layout','layout'],['PhotoFit','photoFit']])$('#emboss'+id).addEventListener('change',e=>{state[key]=e.target.value;if(state.layout==='none')state.move='type';dirty();sync();});
  $('#embossMove').addEventListener('change',e=>{state.move=e.target.value;sync();canvas.focus();schedule();});
  $('#embossPaper').addEventListener('input',e=>{state.paper=e.target.value;invalidate();dirty();sync();});
  $('#embossPhotoCenter').addEventListener('click',()=>{state.photoX=state.photoY=0;state.photoZoom=100;dirty();sync();});
  $('#embossReroll').addEventListener('click',()=>{state.seed++;dirty();});
  $('#embossInput').addEventListener('change',e=>{openFile(e.target.files[0]);e.target.value='';});
  for(const type of ['dragenter','dragover','dragleave','drop'])$('#embossDrop').addEventListener(type,e=>{e.preventDefault();$('#embossDrop').classList.toggle('dragover',type==='dragenter'||type==='dragover');if(type==='drop')openFile(e.dataTransfer.files[0]);});
  $('#embossDemo').addEventListener('click',demo);
  $('#embossRemove').addEventListener('click',()=>{if(state.loading)return;if(state.photo)URL.revokeObjectURL(state.photo.url);state.photo=null;state.palette=[];state.move='type';state.layout='none';invalidate();syncPhoto();sync();dirty();$('#embossPalette').replaceChildren();status('Photo removed · the full sheet is now paper.');});
  window.embossedPrint={activate(){sync();schedule();},refreshFormat(){invalidate();schedule();},reset,hasContent:()=>Boolean(state.photo||state.dirty),getExportOptions:()=>({canExport:!state.loading,motionAvailable:false,outputWidth:state.outputWidth}),setOutputWidth(n){state.outputWidth=[900,1350,3000].includes(Number(n))?Number(n):900;schedule();},exportPng:()=>exportImage('png'),exportJpeg:()=>exportImage('jpeg')};
  sync();render();
})();
