/* SHOTBREAK Timeline Studio — full stack */
(function(){
'use strict';

const STORAGE_KEY='SB_Timeline_v1';
const OWNER_EMAILS=new Set(['kyle@shotbreak.io','scott@shotbreak.io','steve@shotbreak.io']);
const CHAR_SKIP=new Set(['INT','EXT','FADE','CUT','CLOSE','WIDE','THE','AND','RAIN','WATER','ROOF','SCENE','OPENING','DIALOGUE','ACTION','REACTION','CLIMAX','RESOLUTION','EPILOGUE','TRANSITION','ABANDONED','WAREHOUSE','BUILDING','STREET','NIGHT','DAY','MORNING','EVENING','LOCATION','INTERIOR','EXTERIOR']);
const JUNK_CHAR_WORDS=new Set([
  'THE','AND','BUT','FOR','NOT','YOU','ALL','CAN','HER','WAS','ONE','OUR','OUT','ARE','HAS','HIS','HOW','ITS','MAY','NEW','NOW','OLD','SEE','WAY','WHO','DID','GET','HIT','LET','PUT','SAY','SHE','TOO','USE','WHY','ANY','DAY','END','TWO','WAR','YES','YET',
  'STOP','LOOK','THOSE','TONIGHT','THIS','WHAT','WHEN','THAT','SINCE','JUST','THEY','ROCKS','TOGETHER','READY','BESIDE','SWIFTLY','OPENING','SEQUENCE','WRITTEN','ROCKY','CLIFFTOP','HEIGHTS','DRIVE','INTERNATIONAL','AIRPORT','FEBRUARY','GERMAN',
  'FORTY','UNIT','SUN','MEDIA','EXT','INT','SCI','VORSANGER','LONDON','CALLING','MONTREAL','OAKVILLE','SHERWOOD','MOTHERFUCKER','COCKSUCKER','FUCK','THROW','KNOW','ONLY','SURE','THINGS','LIFE','DEATH','TAXES','PAY','STRUGGLES','WILDLY','POWERFUL',
  'LAUNCHES','SCREAMS','STRAIGHTENS','JACKET','TURNS','AROUND','LEAVES','SHAKES','WALKS','ALONE','ATOP','CLIFF','WARRIORS','CHIEF','SWORN'
]);

let state={
  projectName:'Untitled Film',clips:[],characters:{},selectedId:null,selectedChar:null,
  scriptText:'',
  global:{filmStyle:'Cinematic',colorGrade:'Natural',aspectRatio:'16:9',quality:'1080p',audioProfile:'Cinematic',model:'seedance-2.0-turbo',clipDuration:5,language:'English'},
  assembly:{titleText:'',creditsText:'',musicHint:'',sfxHint:''},
  parseResult:null,queue:{running:false}
};
let history={past:[],future:[]}, curUser=null, auth=null;

function $(id){return document.getElementById(id)}
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2800)}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
function formatTime(sec){return Math.floor(sec/60)+':'+String(Math.floor(sec%60)).padStart(2,'0')}

function snapshot(){return JSON.stringify({clips:state.clips,characters:state.characters,global:state.global,assembly:state.assembly,projectName:state.projectName,selectedId:state.selectedId})}
function pushHistory(){history.past.push(snapshot());if(history.past.length>50)history.past.shift();history.future=[];updateUndo()}
function restore(s){const d=JSON.parse(s);state.clips=d.clips||[];state.characters=d.characters||{};state.global=Object.assign(state.global,d.global||{});state.assembly=Object.assign(state.assembly,d.assembly||{});state.projectName=d.projectName||'Untitled Film';state.selectedId=d.selectedId;state.clips.forEach(ensureClip)}
function undo(){if(!history.past.length)return;history.future.push(snapshot());restore(history.past.pop());save();renderAll();toast('Undo')}
function redo(){if(!history.future.length)return;history.past.push(snapshot());restore(history.future.pop());save();renderAll();toast('Redo')}
function updateUndo(){if($('btnUndo'))$('btnUndo').disabled=!history.past.length;if($('btnRedo'))$('btnRedo').disabled=!history.future.length}

function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({clips:state.clips,characters:state.characters,global:state.global,assembly:state.assembly,parseResult:state.parseResult,projectName:state.projectName,scriptText:state.scriptText}))}catch(e){}}
function load(){try{const d=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(!d)return;if(d.clips)state.clips=d.clips;if(d.characters)state.characters=SBCharacters.normalize(d.characters);if(d.global)Object.assign(state.global,d.global);if(d.assembly)Object.assign(state.assembly,d.assembly);if(d.parseResult)state.parseResult=d.parseResult;if(d.projectName)state.projectName=d.projectName;if(d.scriptText)state.scriptText=d.scriptText;state.clips.forEach(ensureClip)}catch(e){}}

function ensureClip(c){
  if(!c.params)c.params={scene:{on:{location:1,timeOfDay:1,weather:0,season:0},location:'',timeOfDay:'Day',weather:'Clear',season:'Summer'},camera:{on:{angle:1,filmGrade:1,colorMode:1,saturation:0},angle:'Medium',filmGrade:'35mm Grain',colorMode:'Color',saturation:'0'},atmosphere:{on:{lighting:1,mood:1,fx:0,sound:0},lighting:'Natural',mood:'Cinematic',fx:'',sound:''}};
  if(!c.edit)c.edit={trimIn:0,trimOut:null,transition:'cut',transitionDur:0.5,speed:1,overlayFx:'',colorCorrect:''};
  if(!c.emotion)c.emotion='Neutral';
}

async function getToken(){if(!auth||!auth.currentUser)throw new Error('Not signed in');return auth.currentUser.getIdToken()}
async function hdrs(){return{'Content-Type':'application/json','Authorization':'Bearer '+(await getToken())}}

function initAuth(){
  if(!window.firebase||!window.SHOTBREAK_CONFIG)return;
  if(!firebase.apps.length)firebase.initializeApp(window.SHOTBREAK_CONFIG.firebase);
  auth=firebase.auth();
  auth.onAuthStateChanged(u=>{
    if(u){const e=(u.email||'').toLowerCase();curUser={name:u.displayName||e.split('@')[0],email:e,isOwner:OWNER_EMAILS.has(e),uid:u.uid};$('loginOverlay').classList.add('hidden');$('userMeta').textContent=curUser.name}
    else{curUser=null;$('loginOverlay').classList.remove('hidden')}
  });
  $('loginBtn').onclick=async()=>{const err=$('loginErr');err.style.display='none';try{await auth.signInWithEmailAndPassword($('loginEmail').value.trim(),$('loginPw').value)}catch(e){err.textContent=e.message;err.style.display='block'}};
}

function buildPrompt(clip){
  const g=state.global,p=clip.params,x=[];
  if(clip.heading)x.push(clip.heading.slice(0,80)+'.');
  if(p.scene.on.location&&p.scene.location)x.push('Location: '+p.scene.location+'.');
  if(p.scene.on.timeOfDay&&p.scene.timeOfDay)x.push('Time: '+p.scene.timeOfDay+'.');
  if(p.scene.on.weather&&p.scene.weather)x.push('Weather: '+p.scene.weather+'.');
  if(p.camera.on.angle&&p.camera.angle)x.push('Camera: '+p.camera.angle+'.');
  if(p.camera.on.filmGrade&&p.camera.filmGrade)x.push('Film: '+p.camera.filmGrade+'.');
  if(p.atmosphere.on.lighting&&p.atmosphere.lighting)x.push('Lighting: '+p.atmosphere.lighting+'.');
  if(p.atmosphere.on.mood&&p.atmosphere.mood)x.push('Mood: '+p.atmosphere.mood+'.');
  if(clip.emotion)x.push('Emotion: '+clip.emotion+'.');
  x.push('Style: '+g.filmStyle+', '+g.colorGrade+'.');
  if(clip.description)x.push(clip.description.slice(0,300));
  if(clip.dialogue)x.push('Dialogue: "'+clip.dialogue.slice(0,120)+'"');
  let pr=x.join(' ').replace(/\s+/g,' ').trim();
  pr=SBCharacters.injectIntoPrompt(pr,state.characters,clip);
  return pr.length>900?pr.slice(0,897)+'...':pr||'Cinematic scene shot';
}

function clipDur(c){return (c.edit.trimOut!=null?c.edit.trimOut:c.durationSec)-(c.edit.trimIn||0)}
function totalDuration(){return state.clips.reduce((a,c)=>a+clipDur(c),0)}

function renderAll(){
  $('projectTitle').textContent=state.projectName;
  if(state.clips.length&&!Object.keys(state.characters).length){
    rebuildCharactersFromProject();
    repairCharactersFromClips();
  }
  renderTimeline();renderScriptEditor();renderAssembly();renderCharacters();renderOutput();renderDetail();updateUndo();
  openCharactersPanelIfNeeded();
}
function openCharactersPanelIfNeeded(){
  if(!state.clips.length)return;
  document.querySelectorAll('.module-panel').forEach(panel=>{
    const sum=panel.querySelector('summary');
    if(sum&&sum.textContent.trim()==='Characters')panel.open=true;
  });
}

/** Read screenplay from textarea, falling back to stored scriptText. */
function scriptEditorText(){
  const ta=$('scriptEditor');
  const stored=(state.scriptText||'').trim();
  if(!ta)return stored;
  const live=(ta.value||'').trim();
  if(live)return ta.value;
  return state.scriptText||'';
}

/** Persist textarea → state.scriptText before parse/import. */
function flushScriptEditor(){
  const ta=$('scriptEditor');
  const raw=ta?(ta.value||''):(state.scriptText||'');
  const trimmed=raw.trim();
  if(trimmed&&!isClipReconstruction(trimmed)){
    state.scriptText=raw;
    save();
  }
  return trimmed?raw:(state.scriptText||'');
}

function isClipReconstruction(text){
  if(SBParser.isClipReconstruction)return SBParser.isClipReconstruction(text);
  const t=String(text||'');
  return (t.match(/^SCENE 1\s*$/gim)||[]).length>=3||(t.match(/delivering dialogue\./gi)||[]).length>=2;
}

function updateScriptMeta(){
  const text=scriptEditorText();
  const lines=text?text.split(/\r?\n/).length:0;
  const chars=text.length;
  const summary=lines+' lines · '+chars+' chars'+(state.clips.length?' · '+state.clips.length+' clips':'');
  const meta=$('scriptMeta');
  if(meta)meta.textContent=summary;
  const bar=$('scriptBarMeta');
  if(bar){
    if(!text.trim())bar.textContent='No screenplay yet — click ✎ Open script editor';
    else if(isClipReconstruction(text))bar.textContent='⚠ Corrupted clip text — open editor & use + New script';
    else if(SBParser.isScriptFlattened&&SBParser.isScriptFlattened(text))bar.textContent='⚠ Flattened script — open editor & click Unflatten';
    else bar.textContent=summary;
  }
}

function renderScriptWarn(text){
  const el=$('scriptWarn');
  if(!el)return;
  const corrupt=isClipReconstruction(text);
  if(corrupt){
    el.classList.remove('hidden');
    el.innerHTML='<strong>Not your original screenplay.</strong> This box was auto-filled from broken timeline clip text (repeated SCENE 1 / shot descriptions). Click <strong>+ New script</strong>, then re-import your .txt / .pdf / .fdx — do not re-parse this garbage.';
    return;
  }
  if(state.clips.length&&!text.trim()){
    el.classList.remove('hidden');
    el.innerHTML='<strong>No screenplay stored.</strong> Import or paste your original script here. The timeline clips alone cannot rebuild a proper screenplay.';
    return;
  }
  el.classList.add('hidden');
  el.innerHTML='';
}

function renderScriptEditor(){
  const ta=$('scriptEditor');
  if(!ta)return;
  if(!ta._focused){
    let blob=state.scriptText||'';
    if(blob&&isClipReconstruction(blob)){
      if(!ta.value.trim()||isClipReconstruction(ta.value)){
        state.scriptText='';
        blob='';
        ta.value='';
        save();
      }
    }else if(blob&&ta.value!==blob){
      ta.value=blob;
    }
  }
  renderScriptWarn(scriptEditorText());
  updateScriptMeta();
}

function openScriptPanel(){
  renderScriptEditor();
  const modal=$('scriptModal');
  if(modal)modal.classList.remove('hidden');
  const ta=$('scriptEditor');
  if(ta)setTimeout(()=>ta.focus(),120);
}
function closeScriptPanel(){
  syncScriptFromEditor();
  const modal=$('scriptModal');
  if(modal)modal.classList.add('hidden');
}

function syncScriptFromEditor(){
  const ta=$('scriptEditor');
  if(!ta)return'';
  const val=ta.value;
  if(isClipReconstruction(val)){
    renderScriptWarn(val);
    updateScriptMeta();
    return val;
  }
  state.scriptText=val;
  save();
  renderScriptWarn(val);
  updateScriptMeta();
  return state.scriptText;
}

function startNewScript(){
  const has=!!(state.clips.length||state.scriptText||(scriptEditorText()||'').trim());
  if(has&&!confirm('Start a new script? This clears the timeline, characters, and stored screenplay. Rendered videos in this session are removed from the timeline (downloads are kept).'))return;
  pushHistory();
  state.scriptText='';
  state.clips=[];
  state.characters={};
  state.parseResult=null;
  state.selectedId=null;
  state.selectedChar=null;
  const ta=$('scriptEditor');
  if(ta){ta.value='';ta._focused=false}
  save();renderAll();openScriptPanel();toast('Ready for a new script — paste or import below');
}

function normalizeImportedScript(raw){
  if(SBParser.normalizeScriptTextDetailed)return SBParser.normalizeScriptTextDetailed(raw);
  const norm=SBParser.normalizeScriptText?SBParser.normalizeScriptText(raw):raw;
  const before=String(raw||'').split('\n').filter(l=>l.trim()).length;
  const after=String(norm||'').split('\n').filter(l=>l.trim()).length;
  return{text:norm,wasFlattened:after>before+3,before,after};
}

function unflattenScriptFromEditor(){
  const ta=$('scriptEditor');
  const raw=ta?(ta.value||''):state.scriptText||'';
  if(!raw.trim()){toast('Paste or import a screenplay first');openScriptPanel();return}
  if(isClipReconstruction(raw)){
    toast('That is broken clip text — use + New script and import your real file');
    openScriptPanel();
    return;
  }
  const flat=SBParser.isScriptFlattened?SBParser.isScriptFlattened(raw):false;
  const norm=normalizeImportedScript(raw);
  pushHistory();
  state.scriptText=norm.text;
  if(ta){ta.value=norm.text;ta._focused=false}
  save();renderScriptEditor();
  if(norm.wasFlattened||flat){
    toast('Unflattened screenplay · '+norm.before+' → '+norm.after+' lines');
  }else{
    toast('Script already has line breaks ('+norm.after+' lines)');
  }
}

async function reparseScriptFromEditor(){
  const text=flushScriptEditor().trim();
  if(!text){toast('Paste or type a screenplay in the Script panel first');openScriptPanel();return}
  if(isClipReconstruction(text)){
    toast('This is reconstructed clip junk — use + New script and re-import your real screenplay');
    openScriptPanel();
    return;
  }
  const hasWork=state.clips.length>0;
  const hasRendered=state.clips.some(c=>c.videoUrl||c.status==='approved');
  if(hasWork){
    let msg='Re-parse and replace the timeline from your edited script?';
    if(hasRendered)msg+=' Clips with generated video will be rebuilt (you may need to re-generate).';
    if(!confirm(msg))return;
  }
  await importText(text,{fromEditor:true});
  openScriptPanel();
}

function renderTimeline(){
  const has=state.clips.length>0;
  $('importZone').classList.toggle('hidden',has);
  $('timelineSection').classList.toggle('hidden',!has);
  if($('flowHint'))$('flowHint').classList.toggle('hidden',has);
  if(!has){$('clipRow').innerHTML='';$('timeRuler').innerHTML='';return}
  let t=0,ticks=[];
  state.clips.forEach(c=>{ticks.push('<span class="time-tick">'+formatTime(t)+'</span>');t+=clipDur(c)});
  ticks.push('<span class="time-tick">'+formatTime(t)+'</span>');
  $('timeRuler').innerHTML=ticks.join('');
  $('clipRow').innerHTML=state.clips.map(c=>{
    const st=c.status==='approved'?'approved':c.status==='done'?'done':c.status==='generating'?'gen':'';
    const th=c.videoUrl?'<video src="'+c.videoUrl+'" muted loop playsinline></video>':'<span class="ph">🎬</span>';
    return '<div class="clip-card'+(c.id===state.selectedId?' active':'')+(c.status==='approved'?' approved':'')+'" data-id="'+c.id+'" draggable="true"><div class="clip-status '+st+'"></div><div class="clip-num">Clip '+String(c.num).padStart(2,'0')+'</div><div class="clip-thumb">'+th+'</div><div class="clip-label">'+esc(c.label)+'</div><div class="clip-dur">~'+c.durationSec+'s</div></div>';
  }).join('');
  $('clipRow').querySelectorAll('.clip-card').forEach(el=>{
    el.onclick=()=>{state.selectedId=el.dataset.id;renderAll()};
    el.ondragstart=e=>e.dataTransfer.setData('text/plain',el.dataset.id);
    el.ondragover=e=>e.preventDefault();
    el.ondrop=e=>{e.preventDefault();reorder(el.dataset.id,e.dataTransfer.getData('text/plain'))};
  });
  $('clipCount').textContent=state.clips.length+' clips · '+formatTime(totalDuration());
}

function reorder(toId,fromId){
  if(!fromId||fromId===toId)return;pushHistory();
  const fi=state.clips.findIndex(c=>c.id===fromId),ti=state.clips.findIndex(c=>c.id===toId);
  if(fi<0||ti<0)return;
  const[item]=state.clips.splice(fi,1);state.clips.splice(ti,0,item);
  state.clips.forEach((c,i)=>{c.num=i+1;c.id='clip-'+String(i+1).padStart(2,'0')});
  save();renderAll();
}

function renderDetail(){
  const clip=state.clips.find(c=>c.id===state.selectedId),body=$('detailBody');
  if(!clip){body.innerHTML='<div class="detail-empty">Select a clip to edit and generate.</div>';$('detailTitle').textContent='Clip';return}
  const label=clip.label.length>28?clip.label.slice(0,26)+'…':clip.label;
  $('detailTitle').textContent='Clip '+String(clip.num).padStart(2,'0')+' · '+label;
  const p=clip.params;
  body.innerHTML=
    '<div class="field"><label>Scene</label><textarea id="d-desc" rows="3">'+esc(clip.description)+'</textarea></div>'+
    '<div class="field"><label>Emotion</label><select id="d-emotion">'+['Neutral','Tense','Joy','Fear','Anger','Sad','Noir'].map(e=>'<option'+(clip.emotion===e?' selected':'')+'>'+e+'</option>').join('')+'</select></div>'+
    '<details class="detail-section"><summary>AI prompt</summary><div class="section-inner"><textarea id="d-prompt" readonly rows="4">'+esc(buildPrompt(clip))+'</textarea></div></details>'+
    '<details class="detail-section"><summary>Scene &amp; setting</summary><div class="section-inner">'+mkTog(p.scene,'location','Location')+mkTog(p.scene,'timeOfDay','Time')+mkTog(p.scene,'weather','Weather')+mkTog(p.scene,'season','Season')+'</div></details>'+
    '<details class="detail-section"><summary>Camera</summary><div class="section-inner">'+mkTog(p.camera,'angle','Angle')+mkTog(p.camera,'filmGrade','Film grade')+mkTog(p.camera,'colorMode','Color')+mkTog(p.camera,'saturation','Saturation')+'</div></details>'+
    '<details class="detail-section"><summary>Atmosphere</summary><div class="section-inner">'+mkTog(p.atmosphere,'lighting','Lighting')+mkTog(p.atmosphere,'mood','Mood')+mkTog(p.atmosphere,'fx','FX')+mkTog(p.atmosphere,'sound','Sound')+'</div></details>'+
    (clip.error?'<div class="err">'+esc(clip.error)+'</div>':'');
  $('d-desc').oninput=e=>{clip.description=e.target.value;save();const pr=$('d-prompt');if(pr)pr.value=buildPrompt(clip)};
  $('d-emotion').onchange=e=>{clip.emotion=e.target.value;save();const pr=$('d-prompt');if(pr)pr.value=buildPrompt(clip)};
  body.querySelectorAll('.toggle').forEach(t=>{t.onclick=()=>{const g=clip.params[t.dataset.grp];g.on[t.dataset.f]=!g.on[t.dataset.f];t.classList.toggle('on',g.on[t.dataset.f]);save();const pr=$('d-prompt');if(pr)pr.value=buildPrompt(clip)}});
  body.querySelectorAll('input[data-grp]').forEach(inp=>{inp.oninput=()=>{clip.params[inp.dataset.grp][inp.dataset.f]=inp.value;save();const pr=$('d-prompt');if(pr)pr.value=buildPrompt(clip)}});
}
function mkTog(grp,f,label){return '<div class="field"><label><span>'+label+'</span><span class="toggle'+(grp.on[f]?' on':'')+'" data-grp="'+(['location','timeOfDay','weather','season'].includes(f)?'scene':['angle','filmGrade','colorMode','saturation'].includes(f)?'camera':'atmosphere')+'" data-f="'+f+'"></span></label><input data-grp="'+(['location','timeOfDay','weather','season'].includes(f)?'scene':['angle','filmGrade','colorMode','saturation'].includes(f)?'camera':'atmosphere')+'" data-f="'+f+'" value="'+esc(grp[f]||'')+'"></div>'}

function renderAssembly(){
  const el=$('assemblyBody'),ok=state.clips.filter(c=>c.status==='approved'&&c.videoUrl);
  if(!ok.length){el.innerHTML='<div class="empty-hint">Approve clips first. Trim, transitions, speed ramp, and titles live here.</div>';return}
  el.innerHTML=ok.map((c,i)=>'<div class="asm-card"><b>Clip '+c.num+'</b> — '+esc(c.label)+
    '<div class="asm-grid"><div class="field"><label>Trim in</label><input type="number" step="0.1" data-id="'+c.id+'" data-k="trimIn" value="'+c.edit.trimIn+'"></div>'+
    '<div class="field"><label>Trim out</label><input type="number" step="0.1" data-id="'+c.id+'" data-k="trimOut" value="'+(c.edit.trimOut!=null?c.edit.trimOut:c.durationSec)+'"></div>'+
    '<div class="field"><label>Transition</label><select data-id="'+c.id+'" data-k="transition">'+['cut','dissolve','fade','wipe'].map(t=>'<option'+(c.edit.transition===t?' selected':'')+'>'+t+'</option>').join('')+'</select></div>'+
    '<div class="field"><label>Speed</label><input type="number" step="0.1" data-id="'+c.id+'" data-k="speed" value="'+c.edit.speed+'"></div>'+
    '<div class="field"><label>Overlay FX</label><input data-id="'+c.id+'" data-k="overlayFx" value="'+esc(c.edit.overlayFx)+'"></div></div>'+
    (i<ok.length-1?'<div class="asm-arrow">↓ '+esc(c.edit.transition)+'</div>':'')+'</div>').join('')+
    '<div class="section-title">Titles &amp; Audio</div>'+
    '<div class="field"><label>Title card</label><input id="a-title" value="'+esc(state.assembly.titleText)+'"></div>'+
    '<div class="field"><label>End credits</label><input id="a-credits" value="'+esc(state.assembly.creditsText)+'"></div>'+
    '<div class="field"><label>Music / SFX</label><input id="a-music" value="'+esc(state.assembly.musicHint)+'"></div>';
  el.querySelectorAll('[data-id]').forEach(inp=>{const c=state.clips.find(x=>x.id===inp.dataset.id);inp.onchange=()=>{pushHistory();const k=inp.dataset.k;if(k==='trimIn'||k==='trimOut'||k==='speed')c.edit[k]=parseFloat(inp.value)||0;else c.edit[k]=inp.value;save()}});
  ['a-title','a-credits','a-music'].forEach((id,i)=>{const k=['titleText','creditsText','musicHint'][i];$(id).oninput=e=>{state.assembly[k]=e.target.value;save()}});
}

function renderCharacters(){
  let listHtml=SBCharacters.renderList(state.characters);
  if(!Object.keys(state.characters).length&&state.clips.length){
    listHtml='<div style="padding:10px 12px;margin-bottom:10px;background:rgba(212,168,67,.08);border:1px solid rgba(212,168,67,.35);border-radius:8px;font-size:12px;line-height:1.5;color:var(--text2)">'+
      '<strong style="color:var(--gold)">Characters empty</strong> — click <strong>↻ Sync from parse</strong> or <strong>re-import</strong> your script (Import / Paste). Names must be in screenplay format (ALL CAPS cue lines or <em>Name: dialogue</em>).</div>'+listHtml;
  }
  $('charListPanel').innerHTML=listHtml;
  $('charListPanel').querySelectorAll('.char-card').forEach(el=>{el.onclick=()=>{state.selectedChar=el.dataset.name;renderCharEditor()}});
  const stripNames=charsForStrip();
  if($('charsStrip'))$('charsStrip').classList.toggle('hidden',!stripNames.length);
  $('charChips').innerHTML=stripNames.map(n=>'<span class="char-chip">'+esc(n)+'</span>').join('');
  renderCharEditor();
}
function renderCharEditor(){
  $('charEditorPanel').innerHTML=SBCharacters.renderEditor(state.selectedChar,state.selectedChar?state.characters[state.selectedChar]:null);
  if(!state.selectedChar)return;
  const c=state.characters[state.selectedChar];
  $('charEditorPanel').querySelectorAll('[data-k]').forEach(el=>{
    const k=el.dataset.k;
    if(el.classList.contains('toggle')){el.onclick=()=>{pushHistory();c[k]=!c[k];el.classList.toggle('on',c[k]);save();renderCharacters()};return}
    el.oninput=el.onchange=()=>{c[k]=el.value;save()};
  });
  const up=$('btnUploadRef');if(up)up.onclick=()=>uploadRef(state.selectedChar);
  const clr=$('btnClearRef');if(clr)clr.onclick=()=>{pushHistory();c.refUrl=null;save();renderCharacters()};
}
async function uploadRef(name){
  const inp=document.createElement('input');inp.type='file';inp.accept='image/*';
  inp.onchange=async()=>{const f=inp.files[0];if(!f)return;try{
    const dataUrl=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f)});
    const r=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:await hdrs(),body:JSON.stringify({action:'upload_image',image_data_url:dataUrl,filename:f.name})});
    const d=await r.json();if(!r.ok||!d.url)throw new Error(d.error||'Upload failed');
    pushHistory();state.characters[name].refUrl=d.url;save();renderCharacters();toast('Reference locked for '+name);
  }catch(e){toast(e.message)}};
  inp.click();
}

function renderOutput(){$('queuePanel').innerHTML=SBExport.renderQueue(state.clips,state.queue);$('outputStats').textContent=state.clips.filter(c=>c.status==='approved').length+' approved · '+state.clips.filter(c=>c.videoUrl).length+' rendered'}

function trustedCharacterNames(text){
  const trusted=new Set();
  if(state.parseResult&&state.parseResult.characters){
    Object.keys(state.parseResult.characters).forEach(n=>trusted.add(String(n).toUpperCase().trim()));
  }
  if(text&&SBParser.extractCharactersFromText&&!isClipReconstruction(text)){
    Object.keys(SBParser.extractCharactersFromText(text)).forEach(n=>trusted.add(String(n).toUpperCase().trim()));
  }
  return trusted;
}

function syncCharactersFromParse(result,text){
  let chars=Object.assign({},(result&&result.characters)||{});
  if(text&&SBParser.extractCharactersFromText&&!isClipReconstruction(text)){
    chars=SBParser.mergeCharMaps(chars,SBParser.extractCharactersFromText(text));
  }
  if(result&&result.scenes){
    result.scenes.forEach(sc=>{
      (sc.shots||[]).forEach(sh=>{
        (sh.characters_in_frame||[]).forEach(n=>{
          const up=String(n||'').replace(/\s*\([^)]*\)\s*/g,'').trim().toUpperCase();
          if(up&&chars[up]===undefined)chars[up]='';
        });
      });
    });
  }
  const normalized=SBCharacters.normalize(chars);
  const out={};
  Object.keys(normalized).forEach(k=>{
    const up=String(k).toUpperCase().trim();
    if(up&&!out[up])out[up]=normalized[k];
  });
  state.characters=pruneJunkCharacters(out,trustedCharacterNames(text));
  const names=Object.keys(state.characters);
  if(names.length&&!state.selectedChar)state.selectedChar=names[0];
}

function pruneJunkCharacters(chars,trusted){
  const trustedSet=trusted||trustedCharacterNames(state.scriptText||'');
  const clipSet=new Set();
  state.clips.forEach(c=>(c.characters||[]).forEach(n=>clipSet.add(String(n).toUpperCase().trim())));
  const out={};
  Object.entries(chars||{}).forEach(([name,val])=>{
    const up=String(name).toUpperCase().trim();
    if(!up||up.length<2||up.length>40)return;
    if(trustedSet.has(up)){out[up]=val;return;}
    if(!clipSet.has(up))return;
    const words=up.split(/\s+/);
    if(words.length>3)return;
    if(words.every(w=>JUNK_CHAR_WORDS.has(w)||CHAR_SKIP.has(w)))return;
    if(words.length===1&&(JUNK_CHAR_WORDS.has(words[0])||CHAR_SKIP.has(words[0])))return;
    out[up]=val;
  });
  if(!Object.keys(out).length&&trustedSet.size){
    trustedSet.forEach(up=>{
      if(chars[up]!==undefined)out[up]=chars[up];
      else if(chars[up.toLowerCase()]!==undefined)out[up]=chars[up.toLowerCase()];
    });
  }
  return out;
}

function charsForStrip(){
  const set=new Set();
  state.clips.forEach(c=>(c.characters||[]).forEach(n=>{const u=String(n||'').toUpperCase().trim();if(u)set.add(u)}));
  const pruned=pruneJunkCharacters(Object.fromEntries([...set].map(n=>[n,{}])));
  return Object.keys(pruned).sort().slice(0,16);
}

function clipTextBlob(){
  if(state.scriptText&&state.scriptText.trim())return state.scriptText;
  if(!state.clips.length)return'';
  const parts=[];
  state.clips.forEach(c=>{
    if(c.heading)parts.push(c.heading);
    if(c.description)parts.push(c.description);
    if(c.dialogue)parts.push(c.dialogue);
  });
  return parts.join('\n');
}

function repairCharactersFromClips(){
  if(!state.clips.length&&!state.scriptText)return false;
  let changed=false;
  state.clips.forEach(c=>{
    (c.characters||[]).forEach(n=>{
      const up=String(n||'').toUpperCase().trim();
      if(!up)return;
      if(!state.characters[up]){
        state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);
        changed=true;
      }
    });
  });
  if(changed)save();
  return changed;
}

/** Re-sync characters from stored script + full re-parse + clip metadata. */
function rebuildCharactersFromProject(){
  if(!state.scriptText||!state.scriptText.trim()||isClipReconstruction(state.scriptText))return false;
  const blob=state.scriptText;
  if(!blob||!blob.trim())return false;
  const base=Object.assign({},(state.parseResult&&state.parseResult.characters)||{});
  let merged=base;
  const dur=parseInt(state.global.clipDuration,10)||5;
  const norm=normalizeImportedScript(blob).text;

  if(SBParser.parse){
    const reparsed=SBParser.parse(norm,dur);
    state.parseResult=reparsed;
    merged=SBParser.mergeCharMaps(merged,reparsed.characters||{});
    (reparsed.scenes||[]).forEach(sc=>{
      (sc.shots||[]).forEach(sh=>{
        (sh.characters_in_frame||[]).forEach(n=>registerCharFromParse(merged,n));
      });
    });
  }
  if(SBParser.extractCharactersFromText&&!isClipReconstruction(norm)){
    merged=SBParser.mergeCharMaps(merged,SBParser.extractCharactersFromText(norm));
  }
  state.clips.forEach(c=>{
    (c.characters||[]).forEach(n=>registerCharFromParse(merged,n));
    const desc=c.description||'';
    const closeOn=desc.match(/Close on\s+([A-Z][A-Z0-9 .'\-]{1,30})/i);
    if(closeOn)registerCharFromParse(merged,closeOn[1]);
  });
  const names=Object.keys(merged).filter(n=>n.length>=2);
  if(!names.length)return false;
  state.characters=SBCharacters.normalize(pruneJunkCharacters(merged,trustedCharacterNames(norm)));
  if(!state.selectedChar)state.selectedChar=names[0];
  save();
  return true;
}
function registerCharFromParse(map,name,desc){
  const up=String(name||'').replace(/\s*\([^)]*\)\s*/g,'').trim().toUpperCase();
  if(!up||up.length<2||up.length>40)return;
  if(CHAR_SKIP.has(up))return;
  if(up.split(/\s+/).every(w=>CHAR_SKIP.has(w)))return;
  if(map[up]===undefined)map[up]=desc||'';
  else if(desc&&!map[up])map[up]=desc;
}

async function importText(text,opts){
  opts=opts||{};
  const raw=String(text||'').trim();
  if(!raw){toast('No screenplay text to parse');openScriptPanel();return}
  if(isClipReconstruction(raw)){
    toast('That text is broken clip output — use + New script, then import your real file');
    openScriptPanel();
    return;
  }
  pushHistory();
  const normInfo=normalizeImportedScript(raw);
  const norm=normInfo.text;
  state.scriptText=norm;
  const ta=$('scriptEditor');
  if(ta){ta.value=norm;ta._focused=false}
  const dur=parseInt(state.global.clipDuration,10)||5;
  const result=SBParser.parse(norm,dur);
  state.parseResult=result;
  state.clips=SBParser.scenesToClips(result,state.global,dur);
  state.clips.forEach(ensureClip);
  syncCharactersFromParse(result,norm);
  rebuildCharactersFromProject();
  state.clips.forEach(c=>{
    const frame=[];
    (c.characters||[]).forEach(n=>{
      const up=String(n||'').toUpperCase().trim();
      if(!up)return;
      frame.push(up);
      if(!state.characters[up])state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);
    });
    if(frame.length)c.characters=frame;
  });
  if(state.clips.length)state.selectedId=state.clips[0].id;
  save();renderAll();
  const nChars=Object.keys(state.characters).length;
  let msg=state.clips.length+' clips'+(nChars?' · '+nChars+' characters':'');
  if(normInfo.wasFlattened)msg='Unflattened '+normInfo.before+'→'+normInfo.after+' lines · '+msg;
  const warn=SBParser.parseQualityWarning?SBParser.parseQualityWarning(result):'';
  if(warn)msg+=' — '+warn;
  toast(msg);
  document.querySelectorAll('.module-panel').forEach(panel=>{
    const sum=panel.querySelector('summary');
    if(sum&&sum.textContent.trim()==='Characters')panel.open=true;
  });
  openScriptPanel();
}
async function importFile(file){
  try{
    const text=await SBParser.readFile(file);
    await importText(text);
  }catch(e){
    toast(e.message||'Import failed');
    openScriptPanel();
  }
}

function addClip(){
  pushHistory();const n=state.clips.length+1;
  const c={id:'clip-'+String(n).padStart(2,'0'),num:n,label:'New beat',heading:'',durationSec:state.global.clipDuration||5,status:'draft',description:'',dialogue:'',characters:[],videoUrl:null,requestId:null,error:null,emotion:'Neutral'};
  ensureClip(c);state.clips.push(c);state.selectedId=c.id;save();renderAll();
}
function duplicateClip(){
  const src=state.clips.find(c=>c.id===state.selectedId);if(!src){toast('Select a clip');return}
  pushHistory();const n=state.clips.length+1;
  const c=JSON.parse(JSON.stringify(src));c.id='clip-'+String(n).padStart(2,'0');c.num=n;c.status='draft';c.videoUrl=null;c.requestId=null;c.error=null;
  state.clips.push(c);state.selectedId=c.id;save();renderAll();toast('Duplicated');
}

async function runJob(clip){
  clip.status='generating';clip.error=null;renderAll();
  let prompt=buildPrompt(clip);
  const ref=SBCharacters.getRefForClip(state.characters,clip);
  try{
    const h=await hdrs();
    const vs=(typeof window.getVideoSettings==='function')?window.getVideoSettings('timeline'):null;
    const dur=vs?vs.duration:Math.min(15,Math.max(3,parseInt(state.global.clipDuration,10)||clip.durationSec||5));
    const asp=vs?vs.aspect_ratio:(state.global.aspectRatio||'16:9');
    const body={action:'submit',model:vs?vs.model:state.global.model,prompt,duration:dur,aspect_ratio:asp,resolution:vs?vs.resolution:(state.global.quality||'720p'),provider:vs?vs.provider:(state.global.model&&state.global.model.includes('grok')?'grok-imagine':'wavespeed')};
    if(ref)body.character_image_url=ref.url;
    const sub=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:h,body:JSON.stringify(body)});
    const sd=await sub.json();
    if(!sub.ok||!sd.request_id)throw new Error(sd.error||sd.detail||'Submit failed');
    clip.requestId=sd.request_id;
    const t0=Date.now();
    while(Date.now()-t0<480000){
      await new Promise(r=>setTimeout(r,5000));
      const pollBody={action:'status',request_id:clip.requestId,model:state.global.model,provider:state.global.model&&state.global.model.includes('grok')?'grok-imagine':'wavespeed'};
      const pr=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:h,body:JSON.stringify(pollBody)});
      const pd=await pr.json();const st=(pd.status||pd.state||'').toUpperCase();
      if(st==='COMPLETED'||st==='SUCCESS'||st==='SUCCEEDED'||st==='DONE'){
        const rr=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:h,body:JSON.stringify({action:'result',request_id:clip.requestId,model:state.global.model,provider:pollBody.provider})});
        const rd=await rr.json();
        clip.videoUrl=rd.video_url||rd.url||(rd.video&&rd.video.url);
        if(!clip.videoUrl)throw new Error('No video URL');
        clip.status='done';save();renderAll();return;
      }
      if(st==='FAILED'||st==='ERROR')throw new Error(pd.error||'Failed');
    }
    throw new Error('Timed out');
  }catch(e){clip.status='draft';clip.error=e.message;save();renderAll();toast(e.message)}
}

async function genSelected(){if(!curUser)return toast('Sign in');const c=state.clips.find(x=>x.id===state.selectedId);if(!c)return toast('Select clip');await runJob(c)}
async function batchGen(){
  if(!curUser)return toast('Sign in');if(state.queue.running)return;
  state.queue.running=true;$('queueBar').classList.add('on');
  for(let i=0;i<state.clips.length;i++){$('queueText').textContent='Clip '+(i+1)+' / '+state.clips.length;await runJob(state.clips[i])}
  state.queue.running=false;$('queueBar').classList.remove('on');toast('Batch done');
}
function approveSelected(){
  const c=state.clips.find(x=>x.id===state.selectedId);if(!c)return toast('Select clip');
  if(!c.videoUrl)return toast('Generate first');
  pushHistory();c.status='approved';save();renderAll();toast('Approved');
}

function previewAll(){
  const vids=state.clips.filter(c=>c.videoUrl);
  if(!vids.length)return toast('No rendered clips');
  $('previewModal').classList.remove('hidden');
  let i=0;const vid=$('previewPlayer');
  function next(){if(i>=vids.length){$('previewModal').classList.add('hidden');return}vid.src=vids[i].videoUrl;$('previewLabel').textContent='Clip '+vids[i].num+' / '+vids.length;i++}
  vid.onended=next;next();
}

function syncGlobal(){['gFilm','gColor','gAspect','gQuality','gAudio','gModel','gDuration','gLang'].forEach(id=>{const el=$(id);if(!el)return});
  state.global.filmStyle=$('gFilm').value;state.global.colorGrade=$('gColor').value;state.global.aspectRatio=$('gAspect').value;
  state.global.quality=$('gQuality').value;state.global.audioProfile=$('gAudio').value;state.global.model=$('gModel').value;
  state.global.clipDuration=parseInt($('gDuration').value,10)||5;state.global.language=$('gLang').value;save()}

function exportEDL(){
  const approved=state.clips.filter(c=>c.status==='approved'&&c.videoUrl);
  SBExport.exportEDL(approved.length?approved:state.clips);
  toast('EDL downloaded');
}
function exportProject(){SBExport.exportProject({clips:state.clips,characters:state.characters,global:state.global,assembly:state.assembly,projectName:state.projectName,scriptText:state.scriptText,parseResult:state.parseResult});toast('Project saved')}
function loadProject(){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json';
  inp.onchange=async()=>{const f=inp.files[0];if(!f)return;pushHistory();const d=JSON.parse(await f.text());
    state.clips=d.clips||[];state.characters=SBCharacters.normalize(d.characters||{});state.global=Object.assign(state.global,d.global||{});
    state.assembly=Object.assign(state.assembly,d.assembly||{});state.projectName=d.projectName||'Imported';
    state.scriptText=d.scriptText||'';state.parseResult=d.parseResult||null;
    const ta=$('scriptEditor');if(ta){ta.value=state.scriptText;ta._focused=false}
    state.clips.forEach(ensureClip);save();renderAll();openScriptPanel();toast('Project loaded')};
  inp.click();
}

async function finalExport(){
  const clips=state.clips.filter(c=>c.status==='approved'&&c.videoUrl);
  if(!clips.length)return toast('Approve clips with video first');
  $('exportModal').classList.remove('hidden');$('exportStatus').textContent='Starting…';
  try{
    const blob=await SBExport.stitchClips(clips,{fade:state.assembly.masterFade||0.3},m=>$('exportStatus').textContent=m);
    SBExport.download('shotbreak-final.'+(blob.type.includes('zip')?'zip':'mp4'),blob,blob.type);
    $('exportStatus').textContent='Done!';
    toast('Final export downloaded');
  }catch(e){$('exportStatus').textContent=e.message;toast(e.message)}
}

function sendEditor(){
  const ok=state.clips.filter(c=>c.status==='approved'&&c.videoUrl);
  if(!ok.length)return toast('Approve clips first');
  const payload=ok.map((c,i)=>({id:c.id,name:'Clip '+c.num,src:c.videoUrl,duration:clipDur(c),order:i,transition:c.edit.transition}));
  try{const prev=JSON.parse(localStorage.getItem('SB_Generated')||'[]');const next=Array.isArray(prev)?prev:[];
    payload.forEach(p=>next.push({...p,source:'timeline',createdAt:Date.now()}));
    localStorage.setItem('SB_Generated',JSON.stringify(next));
    localStorage.setItem('SB_Timeline_Export',JSON.stringify(payload));
  }catch(e){}
  window.open('/editor/','_blank');toast('Sent to editor');
}

function toggleMoreMenu(open){
  const menu=$('moreMenu');const btn=$('btnMoreMenu');if(!menu)return;
  const show=open!==undefined?open:menu.classList.contains('hidden');
  menu.classList.toggle('hidden',!show);
  if(show&&btn){
    const r=btn.getBoundingClientRect();
    menu.style.position='fixed';
    menu.style.top=Math.round(r.bottom+4)+'px';
    menu.style.left=Math.round(r.left)+'px';
    menu.style.zIndex='10060';
  }else{
    menu.style.position='';
    menu.style.top='';
    menu.style.left='';
    menu.style.zIndex='';
  }
}
function bindUI(){
  $('btnMoreMenu').onclick=e=>{e.stopPropagation();toggleMoreMenu()};
  document.addEventListener('click',()=>toggleMoreMenu(false));
  window.addEventListener('scroll',()=>toggleMoreMenu(false),true);
  $('moreMenu').onclick=e=>e.stopPropagation();
  $('fileInput').onchange=async e=>{
    const f=e.target.files[0];
    e.target.value='';
    if(!f)return;
    openScriptPanel();
    toast('Reading '+f.name+'…');
    try{await importFile(f)}catch(err){toast(err.message||'Import failed')}
  };
  $('btnImport').onclick=()=>$('fileInput').click();
  $('btnPaste').onclick=()=>{openScriptPanel();toast('Paste screenplay here, then Re-parse timeline')};
  const btnScript=$('btnScript');
  if(btnScript)btnScript.onclick=openScriptPanel;
  const btnOpenScript=$('btnOpenScript');
  if(btnOpenScript)btnOpenScript.onclick=openScriptPanel;
  const btnBarImport=$('btnBarImport');
  if(btnBarImport)btnBarImport.onclick=()=>$('fileInput').click();
  const btnBarReparse=$('btnBarReparse');
  if(btnBarReparse)btnBarReparse.onclick=()=>reparseScriptFromEditor().catch(e=>toast(e.message));
  const btnCloseScript=$('btnCloseScript');
  if(btnCloseScript)btnCloseScript.onclick=closeScriptPanel;
  const scriptModal=$('scriptModal');
  if(scriptModal)scriptModal.onclick=e=>{if(e.target===scriptModal)closeScriptPanel()};
  const btnEditLink=$('btnEditScriptLink');
  if(btnEditLink)btnEditLink.onclick=openScriptPanel;
  const btnReparse=$('btnReparseScript');
  if(btnReparse)btnReparse.onclick=()=>reparseScriptFromEditor().catch(e=>toast(e.message));
  const btnUnflatten=$('btnUnflattenScript');
  if(btnUnflatten)btnUnflatten.onclick=unflattenScriptFromEditor;
  const btnScriptImport=$('btnScriptImport');
  if(btnScriptImport)btnScriptImport.onclick=()=>$('fileInput').click();
  const btnNewScript=$('btnNewScript');
  if(btnNewScript)btnNewScript.onclick=startNewScript;
  const btnMenuScript=$('btnMenuScript');
  if(btnMenuScript)btnMenuScript.onclick=()=>{toggleMoreMenu(false);openScriptPanel()};
  const scriptTa=$('scriptEditor');
  if(scriptTa&&!scriptTa._wired){
    scriptTa._wired=true;
    scriptTa.addEventListener('focus',()=>{scriptTa._focused=true});
    scriptTa.addEventListener('blur',()=>{scriptTa._focused=false;syncScriptFromEditor()});
    scriptTa.addEventListener('input',()=>{syncScriptFromEditor()});
  }
  $('btnAdd').onclick=addClip;
  $('btnDup').onclick=duplicateClip;
  $('btnUndo').onclick=undo;
  $('btnRedo').onclick=redo;
  $('btnBatch').onclick=batchGen;
  $('btnGen').onclick=genSelected;
  $('btnRegen').onclick=genSelected;
  $('btnApprove').onclick=approveSelected;
  $('btnPreview').onclick=()=>{const c=state.clips.find(x=>x.id===state.selectedId);if(c&&c.videoUrl)window.open(c.videoUrl);else toast('No video')};
  $('btnPreviewAll').onclick=previewAll;
  $('btnExport').onclick=sendEditor;
  $('btnFinal').onclick=finalExport;
  $('btnEDL').onclick=exportEDL;
  $('btnSaveProj').onclick=exportProject;
  $('btnLoadProj').onclick=loadProject;
  const btnResync=$('btnResyncChars');
  if(btnResync)btnResync.onclick=()=>{
    if(rebuildCharactersFromProject()){
      renderAll();
      toast(Object.keys(state.characters).length+' characters synced from parse');
    }else{
      toast('Re-import your script (Import or Paste) — need screenplay text with character names');
    }
  };
  $('btnAddChar').onclick=()=>{const n=prompt('Character name:');if(!n)return;pushHistory();state.characters[n.toUpperCase()]=Object.assign({},SBCharacters.DEFAULTS);state.selectedChar=n.toUpperCase();save();renderCharacters()};
  $('btnClosePreview').onclick=()=>$('previewModal').classList.add('hidden');
  $('btnCloseExport').onclick=()=>$('exportModal').classList.add('hidden');
  ['gFilm','gColor','gAspect','gQuality','gAudio','gModel','gDuration','gLang'].forEach(id=>{const el=$(id);if(el)el.onchange=syncGlobal});
  const btnMore=$('btnSettingsMore'), panelFull=$('settingsFull');
  if(btnMore&&panelFull){
    btnMore.onclick=()=>{
      const open=panelFull.classList.toggle('hidden');
      btnMore.classList.toggle('open',!open);
      btnMore.setAttribute('aria-expanded',!open?'true':'false');
    };
  }
  load();
  if(state.scriptText&&isClipReconstruction(state.scriptText)){
    state.scriptText='';
    save();
  }
  if(state.clips.length||state.scriptText||state.parseResult){
    if(state.parseResult)syncCharactersFromParse(state.parseResult,state.scriptText||'');
    rebuildCharactersFromProject();
    repairCharactersFromClips();
    save();
  }
  const modelMigrate={'seedance-turbo':'seedance-2.0-turbo','seedance':'seedance-2.0-turbo','veo':'veo-3.1'};
  if(state.global.model&&modelMigrate[state.global.model])state.global.model=modelMigrate[state.global.model];
  if(typeof window.initTimelineVideoSettings==='function'){
    if($('gModel')&&state.global.model)$('gModel').value=state.global.model;
    window.initTimelineVideoSettings(syncGlobal,true);
    if($('gModel')&&state.global.model&&window.VIDEO_MODELS&&window.VIDEO_MODELS[state.global.model])$('gModel').value=state.global.model;
    if(typeof window.updateOptionsForModel==='function')window.updateOptionsForModel($('gModel').value,true,'gQuality','gAspect','gDuration');
    if(state.global.aspectRatio&&$('gAspect')){const ok=[...$('gAspect').options].some(o=>o.value===state.global.aspectRatio);if(ok)$('gAspect').value=state.global.aspectRatio;}
    if(state.global.clipDuration&&$('gDuration')){const dv=String(state.global.clipDuration);const ok=[...$('gDuration').options].some(o=>o.value===dv);if(ok)$('gDuration').value=dv;}
    if(state.global.quality&&$('gQuality')){const ok=[...$('gQuality').options].some(o=>o.value===state.global.quality);if(ok)$('gQuality').value=state.global.quality;}
    ['gFilm','gColor','gAudio','gLang'].forEach(id=>{
      const m={gFilm:'filmStyle',gColor:'colorGrade',gAudio:'audioProfile',gLang:'language'};
      const el=$(id);if(!el)return;
      const v=state.global[m[id]];
      if(v==null||v==='')return;
      const has=[...el.options].some(o=>o.value===String(v));
      el.value=has?String(v):el.options[0]?el.options[0].value:'';
    });
    syncGlobal();
  }
  renderAll();
  try{
    if(!localStorage.getItem('SB_Timeline_script_hint_v2')){
      localStorage.setItem('SB_Timeline_script_hint_v2','1');
      setTimeout(()=>toast('Screenplay: gold ✎ Script (top) or yellow bar under Settings'),1200);
    }
  }catch(e){}
}

document.addEventListener('DOMContentLoaded',()=>{initAuth();bindUI()});
})();