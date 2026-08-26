/* Module ⑥⑦ — Editor assembly + Output */
window.SBExport = (function(){
  const FPS_DEFAULT=24;

  /* The frame rate is never assumed silently: every conversion in this file
     goes through normFps, so a missing or nonsense rate becomes 24 in ONE
     place instead of defaulting differently at each call site. */
  function normFps(v){
    v=+v;
    if(!isFinite(v)||v<=0)return FPS_DEFAULT;
    return v;
  }

  /* frames → 'HH:MM:SS:FF' (non-drop).
     The old body read h = Math.floor(frames/fps), which is the count of whole
     SECONDS, and printed it in the hours field — a one-hour cut exported as
     3600:00:00:00 and no finishing house could conform it. Hours are seconds
     divided by 3600; the frame field is the remainder against the nominal
     integer rate, which is what non-drop timecode counts. */
  function ftc(frames,fps){
    const rate=Math.max(1,Math.round(normFps(fps)));
    const total=Math.max(0,Math.round(+frames||0));
    const f=total%rate;
    const s=Math.floor(total/rate)%60;
    const m=Math.floor(total/(rate*60))%60;
    const h=Math.floor(total/(rate*3600));
    return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+
           String(s).padStart(2,'0')+':'+String(f).padStart(2,'0');
  }

  function download(name, content, mime){
    const blob=content instanceof Blob?content:new Blob([content],{type:mime||'application/octet-stream'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=name;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  }

  /* The EDL text itself — pure, so it can be asserted line by line. */
  function buildEDL(clips, fps){
    const rate=Math.max(1,Math.round(normFps(fps)));
    /* The rate is stamped into the file. An EDL carries no frame rate of its
       own beyond FCM, so a conform at the wrong rate is silent — a reader that
       sees this line at least knows what these numbers were counted in. */
    let edl='TITLE: CINAMATE TIMELINE\nFCM: NON-DROP FRAME\n* FRAME RATE: '+rate+'\n\n';
    let fp=0,ev=1;
    (clips||[]).forEach((c,i)=>{
      /* Seconds are rounded to FRAMES once, below — rounding them to whole
         seconds first threw away every sub-second trim. */
      const dur=(c.edit&&c.edit.trimOut!=null?c.edit.trimOut:c.durationSec||0)-(c.edit&&c.edit.trimIn||0);
      const sf=Math.max(1,Math.round(dur*rate));
      const cn=('CLIP_'+String(c.num).padStart(2,'0')).substring(0,32);
      edl+=String(ev).padStart(3,'0')+'  '+cn.padEnd(8).substring(0,8)+' V     C        '+ftc(0,rate)+' '+ftc(sf,rate)+' '+ftc(fp,rate)+' '+ftc(fp+sf,rate)+'\n';
      edl+='* FROM CLIP NAME: '+cn+'\n* LABEL: '+c.label+'\n';
      if(c.videoUrl)edl+='* SOURCE FILE: '+c.videoUrl+'\n';
      if(c.edit&&c.edit.transition&&c.edit.transition!=='cut')edl+='* TRANSITION: '+c.edit.transition+'\n';
      edl+='* DESC: '+(c.description||'').substring(0,200)+'\n\n';
      fp+=sf;ev++;
    });
    return edl;
  }

  function exportEDL(clips, fps){
    const edl=buildEDL(clips,fps);
    download('cinamate-timeline.edl',edl,'text/plain');
    return edl;
  }

  /* The project JSON is a turnover artifact: it is read back by a machine that
     has to know what rate these numbers were counted in. `fps` is written
     explicitly rather than left for the reader to assume. */
  function exportProject(state, fps){
    const out=Object.assign({},state||{},{fps:normFps(fps!=null?fps:(state&&state.fps))});
    download('cinamate-timeline-project.json',JSON.stringify(out,null,2),'application/json');
    return out;
  }

  function renderQueue(clips, queue){
    const items=clips.map(c=>({
      id:c.id,num:c.num,label:c.label,
      status:c.status==='generating'?'running':c.status==='approved'?'approved':c.videoUrl?'done':'queued',
      error:c.error||''
    }));
    if(queue&&queue.running)items.push({id:'batch',num:'—',label:'Batch job',status:'running',error:''});
    if(!items.length)return '<div class="empty-hint">No clips in queue.</div>';
    return '<table class="queue-table"><tr><th>#</th><th>Clip</th><th>Status</th></tr>'+
      items.map(it=>'<tr><td>'+esc(String(it.num))+'</td><td>'+esc(it.label)+'</td><td class="st-'+esc(it.status)+'">'+esc(it.status)+(it.error?' — '+esc(it.error):'')+'</td></tr>').join('')+
      '</table>';
  }

  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

  let ffmpeg=null;

  async function loadFFmpeg(onProgress){
    if(ffmpeg&&ffmpeg.loaded)return ffmpeg;
    if(onProgress)onProgress('Loading FFmpeg…');
    if(typeof SharedArrayBuffer==='undefined')throw new Error('FFmpeg needs HTTPS or localhost with cross-origin isolation');
    const CORE='/static/ffmpeg/ffmpeg-core.js';
    const WASM='/static/ffmpeg/ffmpeg-core.wasm';
    const coreRes=await fetch(CORE);
    const wasmRes=await fetch(WASM);
    if(!coreRes.ok||!wasmRes.ok)throw new Error('Could not load local ffmpeg-core');
    const coreJs=await coreRes.text();
    const wasmBuf=await wasmRes.arrayBuffer();
    const workerSrc=coreJs+'\n'+[
      'self.onmessage=async function(e){',
      '  if(e.data.type==="init"){',
      '    self.ffmpegModule=await createFFmpegCore({',
      '      wasmBinary:new Uint8Array(e.data.wasm),',
      '      print:()=>{},printErr:()=>{}',
      '    });',
      '    self.postMessage({type:"ready"});',
      '  }',
      '  if(e.data.type==="exec"){',
      '    const M=self.ffmpegModule;',
      '    e.data.args.forEach(a=>{const enc=new TextEncoder();const ptr=M._malloc(enc.encode(a).length+1);M.stringToUTF8(a,ptr,enc.encode(a).length+1);M._exec(ptr);M._free(ptr);});',
      '    self.postMessage({type:"done"});',
      '  }',
      '};'
    ].join('');
    const blob=new Blob([workerSrc],{type:'application/javascript'});
    const worker=new Worker(URL.createObjectURL(blob));
    await new Promise((res,rej)=>{
      worker.onmessage=ev=>{if(ev.data.type==='ready')res()};
      worker.onerror=rej;
      worker.postMessage({type:'init',wasm:wasmBuf});
    });
    ffmpeg={loaded:true,worker,wasmBuf,writeFile:async(name,buf)=>{
      /* simplified: use fetch concat via canvas fallback if worker exec fails */
    }};
    return ffmpeg;
  }

  /* Browser-native stitch: sequential download + MediaRecorder fallback using canvas */
  async function stitchClips(clips, opts, onProgress){
    const ready=clips.filter(c=>c.videoUrl);
    if(!ready.length)throw new Error('No video clips to stitch');
    onProgress&&onProgress('Downloading clips…');
    const blobs=[];
    for(let i=0;i<ready.length;i++){
      onProgress&&onProgress('Fetching clip '+(i+1)+' / '+ready.length);
      const r=await fetch(ready[i].videoUrl);
      if(!r.ok)throw new Error('Failed to fetch clip '+ready[i].num);
      blobs.push(await r.blob());
    }
    onProgress&&onProgress('Stitching with FFmpeg…');
    try{
      return await stitchWithFFmpeg(blobs, opts, onProgress);
    }catch(e){
      console.warn('[stitch] ffmpeg failed, using concat blob',e);
      onProgress&&onProgress('FFmpeg unavailable — packaging clips as ZIP');
      return packageZip(blobs, ready);
    }
  }

  async function stitchWithFFmpeg(blobs, opts, onProgress){
    if(!window.SBFFmpeg)throw new Error('FFmpeg module not loaded');
    return window.SBFFmpeg.stitchBlobs(blobs, onProgress);
  }

  async function packageZip(blobs, clips){
    if(typeof JSZip==='undefined')throw new Error('Install JSZip for fallback export');
    const zip=new JSZip();
    blobs.forEach((b,i)=>zip.file('clip_'+String(clips[i].num).padStart(2,'0')+'.mp4',b));
    return await zip.generateAsync({type:'blob'});
  }

  /* ftc/normFps/buildEDL are exported so scripts/test_timeline_export.mjs can
     assert the timecode arithmetic directly instead of through a download. */
  return{ftc,normFps,buildEDL,exportEDL,exportProject,renderQueue,stitchClips,download};
})();