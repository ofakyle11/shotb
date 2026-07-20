/* SHOTBREAK Timeline Studio — full stack */
(function(){
'use strict';

const STORAGE_KEY='SB_Timeline_v1';
const BOOT_VERSION='20260628a';
const OWNER_EMAILS=new Set(['kyle@shotbreak.io','scott@shotbreak.io','steve@shotbreak.io']);
const CHAR_SKIP=new Set(['INT','EXT','FADE','CUT','CLOSE','WIDE','THE','AND','RAIN','WATER','ROOF','SCENE','OPENING','SEQUENCE','DIALOGUE','ACTION','REACTION','CLIMAX','RESOLUTION','EPILOGUE','TRANSITION','ABANDONED','WAREHOUSE','BUILDING','STREET','NIGHT','DAY','MORNING','EVENING','LOCATION','INTERIOR','EXTERIOR']);
const JUNK_CLOSE_ON_RE=/^Close on\s+((?:OPENING|TITLE|CLOSING|END|CREDIT|TEASER|PROLOGUE)\s+(?:SEQUENCE|SCENE|CREDITS)|SEQUENCE|DIALOGUE|ACTION|REACTION|TRANSITION|CLIMAX|RESOLUTION|EPILOGUE|CHARACTER\s+INTRO|OPENING\s+SCENE)/i;
const JUNK_CHAR_WORDS=new Set([
  'THE','AND','BUT','FOR','NOT','YOU','ALL','CAN','HER','WAS','ONE','OUR','OUT','ARE','HAS','HIS','HOW','ITS','MAY','NEW','NOW','OLD','SEE','WAY','WHO','DID','GET','HIT','LET','PUT','SAY','SHE','TOO','USE','WHY','ANY','DAY','END','TWO','WAR','YES','YET',
  'STOP','LOOK','THOSE','TONIGHT','THIS','WHAT','WHEN','THAT','SINCE','JUST','THEY','ROCKS','TOGETHER','READY','BESIDE','SWIFTLY','OPENING','SEQUENCE','WRITTEN','ROCKY','CLIFFTOP','HEIGHTS','DRIVE','INTERNATIONAL','AIRPORT','FEBRUARY','GERMAN',
  'FORTY','UNIT','SUN','MEDIA','EXT','INT','SCI','LONDON','CALLING','MONTREAL','OAKVILLE','SHERWOOD','MOTHERFUCKER','COCKSUCKER','FUCK','THROW','KNOW','ONLY','SURE','THINGS','LIFE','DEATH','TAXES','PAY','STRUGGLES','WILDLY','POWERFUL',
  'LAUNCHES','SCREAMS','STRAIGHTENS','JACKET','TURNS','AROUND','LEAVES','SHAKES','WALKS','ALONE','ATOP','CLIFF','WARRIORS','CHIEF','SWORN'
]);

let state={
  projectName:'Untitled Film',clips:[],characters:{},locationBible:[],propBible:[],continuityRules:null,
  selectedId:null,selectedChar:null,selectedLoc:null,selectedProp:null,
  scriptText:'',
  global:{filmStyle:'Cinematic',colorGrade:'Natural',aspectRatio:'16:9',quality:'1080p',audioProfile:'Cinematic',model:'seedance-2.0-turbo',clipDuration:5,language:'English'},
  assembly:{titleText:'',creditsText:'',musicHint:'',sfxHint:''},
  parseResult:null,queue:{running:false}
};
let history={past:[],future:[]}, curUser=null, auth=null, timelineEditorInst=null;

function $(id){return document.getElementById(id)}
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2800)}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
function formatTime(sec){return Math.floor(sec/60)+':'+String(Math.floor(sec%60)).padStart(2,'0')}

function snapshot(){return JSON.stringify({clips:state.clips,characters:state.characters,locationBible:state.locationBible,propBible:state.propBible,continuityRules:state.continuityRules,global:state.global,assembly:state.assembly,projectName:state.projectName,selectedId:state.selectedId,selectedLoc:state.selectedLoc,selectedProp:state.selectedProp})}
function pushHistory(){history.past.push(snapshot());if(history.past.length>50)history.past.shift();history.future=[];updateUndo()}
function restore(s){const d=JSON.parse(s);state.clips=d.clips||[];state.characters=d.characters||{};state.locationBible=d.locationBible||[];state.propBible=d.propBible||[];state.continuityRules=d.continuityRules||null;state.global=Object.assign(state.global,d.global||{});state.assembly=Object.assign(state.assembly,d.assembly||{});state.projectName=d.projectName||'Untitled Film';state.selectedId=d.selectedId;state.selectedLoc=d.selectedLoc||null;state.selectedProp=d.selectedProp||null;state.clips.forEach(ensureClip)}
function undo(){if(!history.past.length)return;history.future.push(snapshot());restore(history.past.pop());save();renderAll();toast('Undo')}
function redo(){if(!history.future.length)return;history.past.push(snapshot());restore(history.future.pop());save();renderAll();toast('Redo')}
function updateUndo(){if($('btnUndo'))$('btnUndo').disabled=!history.past.length;if($('btnRedo'))$('btnRedo').disabled=!history.future.length}

function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({clips:state.clips,characters:state.characters,locationBible:state.locationBible,propBible:state.propBible,continuityRules:state.continuityRules,global:state.global,assembly:state.assembly,parseResult:state.parseResult,projectName:state.projectName,scriptText:state.scriptText}))}catch(e){}}
function load(){try{const d=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(!d)return;if(d.clips)state.clips=d.clips;if(d.characters)state.characters=SBCharacters.normalize(d.characters);if(d.locationBible)state.locationBible=d.locationBible;if(d.propBible)state.propBible=d.propBible;if(d.continuityRules)state.continuityRules=d.continuityRules;if(d.global)Object.assign(state.global,d.global);if(d.assembly)Object.assign(state.assembly,d.assembly);if(d.parseResult)state.parseResult=d.parseResult;if(d.projectName)state.projectName=d.projectName;if(d.scriptText)state.scriptText=d.scriptText;state.clips.forEach(ensureClip);warnStaleRefs()}catch(e){}}
// Legacy demo-echo uploads left data: URLs in saved projects — those never reach providers.
function warnStaleRefs(){
  try{
    const n=(window.SBStorage&&SBStorage.countStaleRefs)?SBStorage.countStaleRefs(state):0;
    if(n)setTimeout(()=>toast(n+' reference image'+(n>1?'s are':' is')+' stored as data URL and never reach'+(n>1?'':'es')+' the video providers — re-upload in Characters/Locations'),1500);
  }catch(e){}
}

function ensureClip(c){
  const sceneDef={on:{location:1,timeOfDay:1,weather:0,season:0},location:'',timeOfDay:'Day',weather:'Clear',season:'Summer'};
  const cameraDef={on:{angle:1,filmGrade:1,colorMode:1,saturation:0},angle:'Medium',filmGrade:'35mm Grain',colorMode:'Color',saturation:'0'};
  const atmosDef={on:{lighting:1,mood:1,fx:0,sound:0},lighting:'Natural',mood:'Cinematic',fx:'',sound:''};
  if(!c.params)c.params={scene:Object.assign({},sceneDef),camera:Object.assign({},cameraDef),atmosphere:Object.assign({},atmosDef)};
  if(!c.params.scene)c.params.scene=Object.assign({},sceneDef);
  if(!c.params.scene.on)c.params.scene.on=Object.assign({},sceneDef.on);
  if(!c.params.camera)c.params.camera=Object.assign({},cameraDef);
  if(!c.params.camera.on)c.params.camera.on=Object.assign({},cameraDef.on);
  if(!c.params.atmosphere)c.params.atmosphere=Object.assign({},atmosDef);
  if(!c.params.atmosphere.on)c.params.atmosphere.on=Object.assign({},atmosDef.on);
  if(c.params.scene.location==null)c.params.scene.location='';
  if(!c.edit)c.edit={trimIn:0,trimOut:null,transition:'cut',transitionDur:0.5,speed:1,overlayFx:'',colorCorrect:''};
  if(!c.emotion)c.emotion='Neutral';
}

async function getToken(){if(!auth||!auth.currentUser)throw new Error('Not signed in');return auth.currentUser.getIdToken()}
async function hdrs(){return{'Content-Type':'application/json','Authorization':'Bearer '+(await getToken())}}

// Staging marker: visible everywhere EXCEPT the production domain, so the
// test deployment can never be mistaken for the live site.
function initTestBadge(){
  const b=$('testBadge');if(!b)return;
  const h=location.hostname;
  const isProd=h==='shotbreak.io'||h==='www.shotbreak.io';
  b.classList.toggle('hidden',isProd);
}

function initAuth(){
  if(!window.firebase||!window.SHOTBREAK_CONFIG)return;
  if(!firebase.apps.length)firebase.initializeApp(window.SHOTBREAK_CONFIG.firebase);
  auth=firebase.auth();
  auth.onAuthStateChanged(u=>{
    if(u){const e=(u.email||'').toLowerCase();curUser={name:u.displayName||e.split('@')[0],email:e,isOwner:OWNER_EMAILS.has(e),uid:u.uid};$('loginOverlay').classList.add('hidden');$('userMeta').textContent=curUser.name}
    else{curUser=null;$('loginOverlay').classList.remove('hidden');$('userMeta').textContent='—'}
    renderAuthGate();
  });
  const err=$('loginErr'),ok=$('loginOk');
  const showErr=m=>{if(ok)ok.style.display='none';err.textContent=m;err.style.display='block'};
  const showOk=m=>{err.style.display='none';if(ok){ok.textContent=m;ok.style.display='block'}};
  $('loginBtn').onclick=async()=>{err.style.display='none';if(ok)ok.style.display='none';try{await auth.signInWithEmailAndPassword($('loginEmail').value.trim(),$('loginPw').value)}catch(e){showErr(e.message)}};
  const su=$('loginSignupBtn');
  if(su)su.onclick=async()=>{
    const email=$('loginEmail').value.trim(),pw=$('loginPw').value;
    if(!email||!pw)return showErr('Enter an email and password (6+ characters) to create an account');
    try{await auth.createUserWithEmailAndPassword(email,pw);showOk('Account created — you are signed in')}catch(e){showErr(e.message)}
  };
  const rs=$('loginResetBtn');
  if(rs)rs.onclick=async()=>{
    const email=$('loginEmail').value.trim();
    if(!email)return showErr('Enter your email first, then click Forgot password');
    try{await auth.sendPasswordResetEmail(email);showOk('Password reset email sent to '+email)}catch(e){showErr(e.message)}
  };
}

function cleanClipDescription(clip){
  const desc=String(clip.description||'').trim();
  if(!desc)return'';
  if(JUNK_CLOSE_ON_RE.test(desc)||/delivering dialogue\./i.test(desc)&&JUNK_CLOSE_ON_RE.test(desc)){
    if(clip.dialogue)return clip.dialogue.trim();
    if(clip.heading)return clip.heading.trim();
    return'';
  }
  const closeM=desc.match(/^Close on\s+([A-Z][A-Z0-9 .'\-]{1,40})/i);
  if(closeM&&!isValidCharacterName(closeM[1])){
    if(clip.dialogue)return clip.dialogue.trim();
    return desc.replace(/^Close on\s+[A-Z][A-Z0-9 .'\-]{1,40},?\s*/i,'').replace(/,?\s*delivering dialogue\.?/i,'').trim();
  }
  return desc;
}

function pickVideoUrl(d){
  if(!d)return null;
  if(d.video_url)return d.video_url;
  if(d.url)return d.url;
  if(d.video&&d.video.url)return d.video.url;
  const out=d.raw&&d.raw.output;
  if(out&&Array.isArray(out.urls)&&out.urls[0])return out.urls[0];
  return null;
}

function formatGenError(sd,status){
  const err=String((sd&&sd.error)||'').trim();
  const det=String((sd&&sd.detail)||'').trim();
  const code=String((sd&&sd.raw&&sd.raw.error&&sd.raw.error.code)||'').toLowerCase();
  const blob=(err+' '+det).toLowerCase();
  if(code==='insufficient_credits'||/insufficient_credits|balance is too low/.test(blob)){
    return'AI Video API credits exhausted — top up at https://aivideoapi.ai/dashboard/billing';
  }
  if(code==='spend_limit_exceeded'||/spend_limit_exceeded/.test(blob)){
    return'AI Video API key spend limit reached — raise limits at https://aivideoapi.ai/api-keys';
  }
  if(code==='ip_not_allowed'||/ip_not_allowed|ip blocked/.test(blob)){
    return'AI Video API IP blocked — clear IP allowlist on your key at https://aivideoapi.ai/api-keys';
  }
  if(code==='invalid_api_key'||/invalid_api_key/.test(blob)){
    return'AI Video API key invalid — https://aivideoapi.ai/api-keys';
  }
  if(/aivideoapi.*not configured|set_aivideoapi_key/i.test(blob)){
    return'Sora 2 not configured. Owner: run fix-aivideoapi-sora.ps1 with key from https://aivideoapi.ai/api-keys';
  }
  if(/openai.*not configured|set openai_api_key/i.test(blob)){
    return'OpenAI Sora not configured. Owner: POST {action:"set_openai_key",api_key:"sk-..."} to generate-video.';
  }
  if(/unauthorized|invalid.*key|api key/.test(blob)&&!/invalid_request/.test(blob)){
    return'Video API key misconfigured on server ('+(det||err||'check Netlify env')+').';
  }
  if(status===401)return'Session expired — sign out and sign back in.';
  if(status===503)return det||err||'Video service unavailable (API keys not configured).';
  return det||err||'Video generation failed';
}

function repairCorruptClips(){
  if(!state.clips.length)return false;
  let changed=false;
  state.clips.forEach(c=>{
    harvestTraitsFromClip(c);
    const desc=String(c.description||'');
    if(JUNK_CLOSE_ON_RE.test(desc)||(desc.includes('delivering dialogue')&&desc.match(/Close on\s+[A-Z]/i)&&!isValidCharacterName((desc.match(/Close on\s+([A-Z][A-Z0-9 .'\-]{1,40})/i)||[])[1]))){
      const dlg=c.dialogue||'';
      const head=(c.heading||'').trim();
      if(dlg){c.description=dlg.slice(0,400);changed=true}
      else if(head&&head!=='SCENE 1'){c.description=head.slice(0,400);changed=true}
      else{c.description='';changed=true}
    }
    if(c.characters&&c.characters.length){
      const clean=c.characters.filter(n=>isValidCharacterName(n));
      if(clean.length!==c.characters.length){c.characters=clean;changed=true}
    }
  });
  if(changed)save();
  return changed;
}

function buildPrompt(clip){
  const g=state.global,p=clip.params,x=[];
  if(clip.heading&&clip.heading!=='SCENE 1')x.push(clip.heading.slice(0,80)+'.');
  if(p.scene.on.location&&p.scene.location)x.push('Location: '+p.scene.location+'.');
  if(p.scene.on.timeOfDay&&p.scene.timeOfDay)x.push('Time: '+p.scene.timeOfDay+'.');
  if(p.scene.on.weather&&p.scene.weather)x.push('Weather: '+p.scene.weather+'.');
  if(p.camera.on.angle&&p.camera.angle)x.push('Camera: '+p.camera.angle+'.');
  if(p.camera.on.filmGrade&&p.camera.filmGrade)x.push('Film: '+p.camera.filmGrade+'.');
  if(p.atmosphere.on.lighting&&p.atmosphere.lighting)x.push('Lighting: '+p.atmosphere.lighting+'.');
  if(p.atmosphere.on.mood&&p.atmosphere.mood)x.push('Mood: '+p.atmosphere.mood+'.');
  if(clip.emotion)x.push('Emotion: '+clip.emotion+'.');
  x.push('Style: '+g.filmStyle+', '+g.colorGrade+'.');
  const desc=cleanClipDescription(clip);
  if(desc)x.push(desc.slice(0,300));
  if(clip.dialogue&&!desc.includes(clip.dialogue.slice(0,40)))x.push('Dialogue: "'+clip.dialogue.slice(0,120)+'"');
  let pr=x.join(' ').replace(/\s+/g,' ').trim();
  const safeClip=Object.assign({},clip,{characters:(clip.characters||[]).filter(n=>isValidCharacterName(n))});
  pr=SBCharacters.injectIntoPrompt(pr,state.characters,safeClip);
  if(window.SBContinuity&&typeof SBContinuity.enrichPromptWithContinuity==='function'){
    pr=SBContinuity.enrichPromptWithContinuity(pr,state,clip);
  }
  return pr.length>900?pr.slice(0,897)+'...':pr||'Cinematic scene shot';
}

function clipDur(c){return (c.edit.trimOut!=null?c.edit.trimOut:c.durationSec)-(c.edit.trimIn||0)}
function totalDuration(){return state.clips.reduce((a,c)=>a+clipDur(c),0)}

function cleanLocName(s){
  return String(s||'')
    .replace(/^\s*(?:at|inside|outside|near)\s+(?:the\s+)?/i,'')
    .replace(/^\s*in\s+(?:the\s+)?/i,'')
    .replace(/\s+/g,' ')
    .trim();
}
function canonicalLocName(name){
  const script=String((state&&state.scriptText)||'');
  const anchors=(window.SBContinuity&&SBContinuity.getRules)?SBContinuity.getRules(state).anchors:null;
  if(window.SBLocEnrich&&typeof SBLocEnrich.canonicalLocName==='function'){
    return SBLocEnrich.canonicalLocName(name,script,anchors);
  }
  return cleanLocName(name);
}
function locKeyName(name){const n=canonicalLocName(name);return n?n.toUpperCase().replace(/\s+/g,' '):''}

function scriptHasSluglines(text){
  return /^\s*(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)/im.test(String(text||''));
}

function getClipLocationRaw(clip){
  const p=clip.params&&clip.params.scene;
  const vals=[p&&p.location,clip.location,clip.sceneLocation,clip.setting&&clip.setting.location];
  for(let i=0;i<vals.length;i++){
    const v=String(vals[i]||'').trim();
    if(v)return v;
  }
  return'';
}

function parseLocFromText(raw){
  const t=String(raw||'').trim();
  if(!t)return'';
  const locTag=t.match(/\bLocation:\s*([^.;\n]{3,120})/i);
  if(locTag){
    const n=canonicalLocName(locTag[1].trim());
    if(n.length>2&&!/^SCENE\s*\d*$/i.test(n))return n;
  }
  const slug=t.match(/\b(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.?)\s+([^\n.!?\]]{2,120})/i);
  if(slug){
    const n=canonicalLocName(slug[1].split(/\s*[-—–]\s*/)[0].trim());
    if(n.length>2&&!/^SCENE\s*\d*$/i.test(n)&&!/^(DAY|NIGHT|MORNING|EVENING|CONTINUOUS)$/i.test(n))return n;
  }
  const atM=t.match(/\b(?:at|in|inside|outside|near)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 .'\-/&,]{4,100})/i);
  if(atM){
    const n=canonicalLocName(atM[1].replace(/[.,;]+$/, '').trim());
    if(n.length>4&&!/^SCENE\s*\d*$/i.test(n))return n;
  }
  const direct=canonicalLocName(t);
  if(direct.length>2&&!/^SCENE\s*\d*$/i.test(direct)&&!/^(DAY|NIGHT|MORNING|EVENING|OPENING|DIALOGUE|ACTION)$/i.test(direct))return direct;
  return'';
}

function upsertLocEntry(bible,byKey,name,heading,ci){
  const clean=canonicalLocName(name);
  if(!clean||clean.length<2||/^SCENE\s*\d*$/i.test(clean))return false;
  const key=locKeyName(clean);
  if(!key)return false;
  let loc=byKey[key];
  if(!loc){
    loc={name:clean,key,description:(heading&&heading!=='SCENE 1'?heading:clean),locked:false,plateUrl:null,consistencyPhrase:'',clipIndices:[]};
    bible.push(loc);byKey[key]=loc;
  }
  if(ci!=null&&loc.clipIndices.indexOf(ci)<0)loc.clipIndices.push(ci);
  if(heading&&heading!=='SCENE 1'&&(!loc.description||loc.description===loc.name))loc.description=heading;
  return true;
}

function countCueLines(text){
  if(SBParser&&SBParser.countCueLines)return SBParser.countCueLines(text);
  return (String(text||'').match(/^\s*[A-Z][A-Z0-9 .'\-]{1,35}\s*$/gm)||[]).length;
}

/** Script usable for full parse — sluglines or cue lines override clip-recon false positive. */
function usableScriptText(){
  const t=(state.scriptText||'').trim();
  if(!t)return'';
  if(scriptHasSluglines(t))return state.scriptText;
  if(countCueLines(t)>=2)return state.scriptText;
  if(t.length>400&&t.split(/\r?\n/).filter(l=>l.trim()).length>=15&&!isClipReconstruction(t))return state.scriptText;
  if(!isClipReconstruction(t))return state.scriptText;
  return'';
}

function screenplayText(){return usableScriptText();}

/** Always build text from timeline clips — never corrupted scriptText. */
function clipsTextBlob(){
  if(!state.clips.length)return'';
  const parts=[];
  state.clips.forEach(c=>{
    if(c.heading)parts.push(c.heading);
    const loc=getClipLocationRaw(c);
    if(loc)parts.push('Location: '+loc);
    if(c.description)parts.push(c.description);
    if(c.dialogue)parts.push(c.dialogue);
    (c.characters||[]).forEach(n=>parts.push(String(n)));
  });
  return parts.join('\n');
}

/** Best text for cast/location mining — real screenplay first, else clip metadata. */
function extractionText(){
  const script=usableScriptText();
  if(script)return script;
  const clipBlob=clipsTextBlob();
  if(clipBlob.trim())return clipBlob;
  const raw=(state.scriptText||'').trim();
  if(raw&&!isClipReconstruction(raw))return state.scriptText;
  return'';
}

function charactersNeedHydration(){
  const keys=Object.keys(state.characters||{});
  if(!keys.length)return true;
  return keys.some(k=>{const c=state.characters[k];return!c||!String(c.description||'').trim();});
}

function isDescriptiveTrait(s){
  const d=String(s||'').trim();
  if(!d||d.length<3)return false;
  if(/^(v\.?o\.?|o\.?s\.?|cont'?d|whispering|shouting|beat|pause)$/i.test(d))return false;
  if(/^(to|at|from|with|into)\s+[A-Za-z][A-Za-z .'\-]{0,30}\.?$/i.test(d))return false;
  if(/reads\s*["']\s*["']/i.test(d))return false;
  if(/^(his|her|their)\s+(?:nametag|name\s*tag|nameplate|badge)\s+reads\b/i.test(d))return false;
  return /\d|s|hair|suit|jacket|eyes|weathered|military|tall|old|young|beard|scar|worn|tailored|silver|grey|gray|dark|pale/i.test(d)||d.length>12;
}

function inferLocFromClipText(clip){
  const fields=[getClipLocationRaw(clip),clip.heading,clip.description,clip.dialogue,clip.label];
  for(let i=0;i<fields.length;i++){
    const loc=parseLocFromText(fields[i]);
    if(loc)return loc;
  }
  return'';
}

function locationsFromScriptText(text){
  if(!text||!SBParser||!SBParser.extractLocationsFromText)return{};
  const t=String(text||'');
  if(!/\b(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(t)&&!/^\s*Location:\s/im.test(t))return{};
  return SBParser.extractLocationsFromText(text);
}

function mineLocationsFromParseScenes(){
  const scenes=state.parseResult&&state.parseResult.scenes;
  if(!scenes||!state.clips.length)return 0;
  let n=0;
  state.clips.forEach(clip=>{
    ensureClip(clip);
    const si=clip.sceneIdx;
    if(si==null||!scenes[si])return;
    const heading=scenes[si].heading||'';
    const loc=parseLocFromText(heading)||(SBParser.inferLocation?SBParser.inferLocation(heading):'');
    if(loc&&(!getClipLocationRaw(clip)||/^at\s+/i.test(getClipLocationRaw(clip)))){
      clip.params.scene.location=loc;
      n++;
    }
  });
  return n;
}

function harvestTraitsFromClip(clip){
  const desc=String(clip.description||'');
  const patterns=[
    /Close on\s+([A-Z][A-Z0-9 .'\-]{1,30})\s*\(([^)]+)\)/i,
    /\b([A-Z][A-Z0-9 .'\-]{1,30})\s*\(([^)]{4,200})\)/i
  ];
  for(let pi=0;pi<patterns.length;pi++){
    const m=desc.match(patterns[pi]);
    if(!m||!isValidCharacterName(m[1])||!isDescriptiveTrait(m[2]))continue;
    const up=String(m[1]).toUpperCase().trim();
    if(!state.characters[up])state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);
    const c=state.characters[up];
    const trait=m[2].trim();
    if(!c.description||trait.length>String(c.description).length)c.description=trait;
    if(!(clip.characters||[]).some(n=>String(n).toUpperCase().trim()===up)){
      clip.characters=clip.characters||[];
      clip.characters.push(up);
    }
    return up;
  }
  return null;
}

function mineProjectMetadata(){
  let changed=false;
  mineLocationsFromParseScenes();
  state.clips.forEach(clip=>{
    ensureClip(clip);
    harvestTraitsFromClip(clip);
    const loc=inferLocFromClipText(clip);
    if(loc&&(!getClipLocationRaw(clip)||String(getClipLocationRaw(clip)).trim()==='')){
      clip.params.scene.location=loc;
      changed=true;
    }
  });
  const pm=state.parseResult&&state.parseResult.characters;
  if(pm){
    Object.keys(pm).forEach(k=>{
      const up=String(k).toUpperCase().trim();
      if(!up||!isValidCharacterName(up))return;
      if(!state.characters[up])state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);
      const d=String(pm[k]||'').trim();
      if(d&&(!state.characters[up].description||d.length>String(state.characters[up].description).length)){
        state.characters[up].description=d;
        changed=true;
      }
    });
  }
  if(changed)save();
}

function bootstrapLocationsInline(){
  const bible=state.locationBible||[];
  const byKey={};
  bible.forEach(l=>{if(l&&l.key){if(!l.clipIndices)l.clipIndices=[];byKey[l.key]=l}});
  state.clips.forEach((clip,ci)=>{
    ensureClip(clip);
    const heading=clip.heading||'';
    let name=parseLocFromText(getClipLocationRaw(clip))||inferLocFromClipText(clip);
    if(SBParser&&SBParser.parseSceneHeading){
      const m=SBParser.parseSceneHeading(heading);
      if(m&&m.name)name=name||cleanLocName(m.name);
    }else{
      name=name||parseLocFromText(heading);
    }
    const si=clip.sceneIdx;
    const sc=state.parseResult&&state.parseResult.scenes&&si!=null?state.parseResult.scenes[si]:null;
    if(sc&&sc.heading){
      name=name||parseLocFromText(sc.heading)||(SBParser.inferLocation?cleanLocName(SBParser.inferLocation(sc.heading)):'');
    }
    upsertLocEntry(bible,byKey,name,heading||sc&&sc.heading,ci);
  });
  const scriptBlob=extractionText();
  Object.values(locationsFromScriptText(scriptBlob)).forEach(row=>{
    if(!row||!row.key)return;
    upsertLocEntry(bible,byKey,row.name,row.heading,null);
  });
  const scenes=state.parseResult&&state.parseResult.scenes;
  if(scenes){
    scenes.forEach(sc=>{
      const h=sc.heading||'';
      const name=parseLocFromText(h)||(SBParser.inferLocation?cleanLocName(SBParser.inferLocation(h)):'');
      upsertLocEntry(bible,byKey,name,h,null);
    });
  }
  state.locationBible=bible;
  if(!state.selectedLoc&&bible.length)state.selectedLoc=bible[0].key;
  return bible.length;
}

function bootstrapCharactersInline(){
  Object.keys(state.characters||{}).forEach(name=>{
    const c=state.characters[name];
    if(!c)return;
    if(c.desc&&!c.description)c.description=c.desc;
    delete c.desc;
    if(c.description&&String(c.description).trim())return;
    const up=String(name).toUpperCase();
    const pm=state.parseResult&&state.parseResult.characters;
    const fromParse=pm&&(pm[up]||pm[name]);
    if(fromParse&&String(fromParse).trim()){c.description=String(fromParse).trim();return}
    for(let i=0;i<state.clips.length;i++){
      const clip=state.clips[i];
      const blob=((clip.description||'')+' '+(clip.dialogue||'')+' '+(clip.heading||'')).toUpperCase();
      const inClip=(clip.characters||[]).some(n=>String(n).toUpperCase().trim()===up)||blob.includes(up);
      if(!inClip)continue;
      const desc=String(clip.description||'');
      const m=desc.match(new RegExp(up.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\(([^)]+)\\)','i'));
      if(m&&m[1]&&isDescriptiveTrait(m[1])){c.description=m[1].trim();return}
      if(desc.length>12&&!/^Close on\s+/i.test(desc)&&isDescriptiveTrait(desc)){c.description=desc.slice(0,300);return}
    }
  });
  try{
    if(window.SBCharacters){
      const blob=extractionText();
      const pm=(state.parseResult&&state.parseResult.characters)||{};
      if(typeof SBCharacters.hydrate==='function')SBCharacters.hydrate(state.characters,blob,state.clips,pm);
      else if(typeof SBCharacters.enrichAll==='function')SBCharacters.enrichAll(state.characters,blob,state.clips,pm);
    }
  }catch(e){console.warn('[Shotbreak] character module hydrate',e)}
  return Object.values(state.characters).filter(c=>c.description&&String(c.description).trim()).length;
}

function ensureCharactersFromClips(){
  if(!state.clips.length)return 0;
  let added=0;
  state.clips.forEach(c=>{
    (c.characters||[]).forEach(n=>{
      const up=String(n||'').toUpperCase().trim();
      if(!up||!isValidCharacterName(up))return;
      if(!state.characters[up]){state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);added++}
    });
    harvestTraitsFromClip(c);
    const desc=String(c.description||'');
    const closeM=desc.match(/Close on\s+([A-Z][A-Z0-9 .'\-]{1,30})/i);
    if(closeM&&isValidCharacterName(closeM[1])){
      const up=closeM[1].toUpperCase().trim();
      if(!state.characters[up]){state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);added++}
    }
  });
  return added;
}

/** Mine named roles + traits from clip descriptions/dialogue (background cast). */
function mineCharactersFromClips(){
  if(!state.clips.length)return 0;
  let added=0;
  const patterns=[
    /(?:^|[\n.!?]\s*)(?:A|AN|TWO|THREE|FOUR|SEVERAL)\s+([A-Z][A-Z0-9 .'\-]{2,30}(?:\s+[A-Z][A-Z0-9 .'\-]{2,30}){0,3})\s*\(([^)]{3,160})\)/gi,
    /\b([A-Z][A-Z0-9 .'\-]{2,30})\s*\(([^)]{4,160})\)\s*(?=[a-z])/gi,
    /Close on\s+([A-Z][A-Z0-9 .'\-]{1,30})\s*\(([^)]{3,160})\)/gi
  ];
  state.clips.forEach(c=>{
    const blob=[c.heading,c.description,c.dialogue].filter(Boolean).join('\n');
    patterns.forEach(re=>{
      re.lastIndex=0;
      let m;
      while((m=re.exec(blob))!==null){
        const up=String(m[1]||'').replace(/\s*\([^)]*\)\s*/g,'').trim().toUpperCase();
        if(!up||!isValidCharacterName(up))continue;
        if(!state.characters[up]){state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);added++}
        const trait=String(m[2]||'').trim();
        if(trait&&isDescriptiveTrait(trait)){
          const ch=state.characters[up];
          if(!ch.description||trait.length>String(ch.description).length)ch.description=trait;
        }
        if(!(c.characters||[]).some(n=>String(n).toUpperCase().trim()===up)){
          c.characters=c.characters||[];
          c.characters.push(up);
        }
      }
    });
    const cueLines=blob.match(/^\s*([A-Z][A-Z0-9 .'\-]{2,30})\s*$/gm)||[];
    cueLines.forEach(line=>{
      const up=String(line).trim().toUpperCase();
      if(!isValidCharacterName(up))return;
      if(!state.characters[up]){state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);added++}
    });
  });
  if(added)save();
  return added;
}

function repairAllCharacterDescriptions(){
  if(window.SBEnrich&&typeof SBEnrich.repairAllCharacterDescriptions==='function'){
    return SBEnrich.repairAllCharacterDescriptions(state.characters);
  }
  if(window.SBCharacters&&typeof SBCharacters.sanitizeDescription==='function'){
    let n=0;
    Object.keys(state.characters||{}).forEach(name=>{
      const c=state.characters[name];
      if(!c||c._descLocked)return;
      const clean=SBCharacters.sanitizeDescription(c.description||'',name);
      if(clean!==(c.description||'')){c.description=clean;n++}
    });
    return n;
  }
  return 0;
}

function masteryStats(){
  const names=Object.keys(state.characters);
  const charFilled=Object.values(state.characters).filter(c=>c.description&&String(c.description).trim()).length;
  const locN=(state.locationBible||[]).length;
  const clipsWithLoc=state.clips.filter(c=>!!parseLocFromText(getClipLocationRaw(c))||!!inferLocFromClipText(c)).length;
  const el=$('tbBuildVer');
  if(el)el.textContent='build '+BOOT_VERSION+' · '+locN+' loc ('+clipsWithLoc+'/'+state.clips.length+' clips) · '+charFilled+'/'+names.length+' chars';
  return{locN,charFilled,total:names.length,clipsWithLoc};
}

/** Layer 1 — local structure: parse, cast names, locations. No LLM, no heavy hydrate. */
function bootstrapStructure(force,opts){
  opts=opts||{};
  mineProjectMetadata();
  ensureCharactersFromClips();
  if(!opts.skipClipMine)mineCharactersFromClips();
  repairCharactersFromClips();
  const script=usableScriptText();
  const extractBlob=extractionText();
  try{
    if(script&&SBParser&&SBParser.parse&&(force||!state.parseResult||!state.parseResult.scenes)){
      const norm=normalizeImportedScript(script).text;
      state.parseResult=SBParser.parse(norm,parseInt(state.global.clipDuration,10)||5);
      if(norm&&norm!==state.scriptText){state.scriptText=norm;save()}
    }
    syncCharactersFromParse(state.parseResult||{characters:{},scenes:[]},extractBlob,{skipHydrate:true});
  }catch(e){console.warn('[Shotbreak] parse',e)}
  if(force)state.locationBible=[];
  backfillClipLocationsFromParse();
  ensureShotOneLocation();
  bootstrapLocationsInline();
  if(window.SBContinuity&&typeof SBContinuity.applyGraph==='function'){
    try{SBContinuity.applyGraph(state)}catch(e){console.warn('[Shotbreak] SBContinuity',e)}
  }
  if(window.SBLocations&&typeof SBLocations.syncAll==='function'){
    try{state.locationBible=SBLocations.syncAll(state,extractionText())}catch(e){console.warn('[Shotbreak] SBLocations',e)}
  }
  if(window.SBLocEnrich&&typeof SBLocEnrich.buildLocalAliasMap==='function'){
    try{
      const trusted=(state.locationBible||[]).map(function(l){return l&&l.key;}).filter(Boolean);
      const aliasMap=SBLocEnrich.buildLocalAliasMap(trusted,state.scriptText||'');
      SBLocEnrich.mergeLocationBible(state,aliasMap);
      SBLocEnrich.applyAliasesToClips(state,aliasMap);
      if(window.SBContinuity&&typeof SBContinuity.applyGraph==='function')SBContinuity.applyGraph(state);
    }catch(e){console.warn('[Shotbreak] SBLocEnrich local merge',e)}
  }
  repairAllCharacterDescriptions();
  applyCastRoles(state.characters,state.clips);
  const names=Object.keys(state.characters);
  if(names.length&&!state.selectedChar)state.selectedChar=names[0];
  if((state.locationBible||[]).length&&!state.selectedLoc)state.selectedLoc=state.locationBible[0].key;
  save();
  return masteryStats();
}

function bootstrapMastery(force,opts){
  opts=opts||{};
  const r=bootstrapStructure(force,opts);
  if(!opts.skipHydrate){
    try{hydrateAllCharacters(force)}catch(e){console.warn('[Shotbreak] hydrateAllCharacters',e)}
    bootstrapCharactersInline();
    repairAllCharacterDescriptions();
    save();
    return masteryStats();
  }
  return r;
}

/** Layer 2 — Grok character enricher on explicit sync / import. */
async function syncMasteryWithAgent(force){
  const r=bootstrapStructure(force,{skipClipMine:false});
  let agentMsg='';
  if(window.SBEnrich&&typeof SBEnrich.enrichViaAgent==='function'){
    try{
      if(auth&&auth.currentUser)toast('Extracting character bible…');
      const ar=await SBEnrich.enrichViaAgent(state,{getHeaders:hdrs});
      if(ar.ok){
        agentMsg=' · AI enriched '+ar.merged+'/'+ar.total;
      }else if(ar.reason==='not_signed_in'||ar.reason==='no_auth'){
        agentMsg=' · sign in for AI character bible';
        try{hydrateAllCharacters(true)}catch(e){}
        bootstrapCharactersInline();
      }else if(ar.fallback){
        agentMsg=' · local extract (AI unavailable)';
        try{hydrateAllCharacters(true)}catch(e){}
        bootstrapCharactersInline();
      }else{
        agentMsg=' · agent: '+ar.reason;
      }
    }catch(e){
      console.warn('[Shotbreak] enrichViaAgent',e);
      agentMsg=' · local extract fallback';
      try{hydrateAllCharacters(true)}catch(err){}
      bootstrapCharactersInline();
    }
  }else{
    try{hydrateAllCharacters(true)}catch(e){}
    bootstrapCharactersInline();
  }
  let locMsg='';
  if(window.SBLocEnrich&&typeof SBLocEnrich.enrichViaAgent==='function'){
    try{
      if(auth&&auth.currentUser)toast('Merging locations across scenes…');
      const lr=await SBLocEnrich.enrichViaAgent(state,{getHeaders:hdrs});
      if(lr.ok){
        locMsg=' · '+lr.total+' loc'+(lr.merged?' ('+lr.merged+' merged)':'')+(lr.enriched?' · AI atmosphere':'' );
      }else if(lr.merged){
        locMsg=' · '+lr.merged+' location'+(lr.merged===1?'':'s')+' merged locally';
        if(lr.fallback)locMsg+=' (sign in for AI atmosphere)';
      }else if(lr.reason==='not_signed_in'){
        locMsg=' · sign in to merge locations with AI';
      }
      renderLocations();
    }catch(e){
      console.warn('[Shotbreak] enrichLocations',e);
      locMsg=' · location merge fallback';
    }
  }
  repairAllCharacterDescriptions();
  save();
  const stats=masteryStats();
  stats.agentMsg=agentMsg+locMsg;
  return stats;
}

function masterySyncMessage(r){
  const extra=r&&r.agentMsg?r.agentMsg:'';
  if(!r.total&&!r.locN){
    if(r.clipsWithLoc&&!r.locN)return'Found location on '+r.clipsWithLoc+' clips but bible empty — hard refresh (Ctrl+Shift+R)';
    return'No locations found — set Location on a clip (right panel) or re-import script with INT./EXT. lines';
  }
  return r.charFilled+'/'+r.total+' chars · '+r.locN+' locations synced'+extra;
}

function hydrateAllCharacters(force){
  const script=screenplayText();
  let blob=extractionText();
  if(!blob.trim()&&!state.clips.length)return;

  if(script&&SBParser&&SBParser.parse){
    const norm=normalizeImportedScript(script).text;
    const dur=parseInt(state.global.clipDuration,10)||5;
    if(force||!state.parseResult||!Object.keys(state.parseResult.characters||{}).length){
      state.parseResult=SBParser.parse(norm,dur);
    }
    const parseMap=state.parseResult.characters||{};
    Object.keys(parseMap).forEach(k=>{
      const up=String(k).toUpperCase().trim();
      if(!up||!isValidCharacterName(up))return;
      if(!state.characters[up])state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);
      const d=String(parseMap[k]||'').trim();
      if(d&&(!state.characters[up].description||d.length>String(state.characters[up].description||'').length)){
        state.characters[up].description=d;
      }
    });
    if(force||charactersNeedHydration())syncCharactersFromParse(state.parseResult,norm);
    if(SBCharacters&&typeof SBCharacters.hydrate==='function')SBCharacters.hydrate(state.characters,norm,state.clips,parseMap);
    else bootstrapCharactersInline();
  }else{
    if(!Object.keys(state.characters).length){
      rebuildCharactersFromProject();
      repairCharactersFromClips();
    }
    let parseMap=(state.parseResult&&state.parseResult.characters)||{};
    if(script&&SBParser.extractCharactersFromText){
      parseMap=SBParser.mergeCharMaps(parseMap,SBParser.extractCharactersFromText(script));
    }
    if(SBCharacters&&typeof SBCharacters.hydrate==='function')SBCharacters.hydrate(state.characters,blob,state.clips,parseMap);
    else bootstrapCharactersInline();
  }
  save();
}
function ensureCharacterDetails(){
  if(state.clips.length||state.scriptText)bootstrapMastery(false,{skipHydrate:true});
}
function renderAll(){
  $('projectTitle').textContent=state.projectName;
  repairCorruptClips();
  if(state.clips.length||state.scriptText)bootstrapMastery(false,{skipHydrate:true});
  renderTimeline();renderScriptEditor();renderAssembly();renderCharacters();renderLocations();renderProps();renderOutput();renderDetail();updateUndo();
  renderStepper();renderAuthGate();
  openSidePanelsIfNeeded();
}

/* ── guided workflow stepper ── */
function stepperProgress(){
  const clips=state.clips.length;
  const gen=state.clips.filter(c=>c.videoUrl).length;
  const approved=state.clips.filter(c=>c.status==='approved').length;
  const chars=Object.keys(state.characters).length;
  const charRefs=Object.keys(state.characters).filter(n=>{const c=state.characters[n];return c&&(c.refUrl||'').startsWith('https://')}).length;
  const locs=(state.locationBible||[]).length;
  const locked=(state.locationBible||[]).filter(l=>l&&l.locked).length;
  return {clips,gen,approved,chars,charRefs,locs,locked};
}
function renderStepper(){
  const bar=$('stepper');if(!bar)return;
  const p=stepperProgress();
  const scriptDone=p.clips>0;
  const castDone=scriptDone&&p.chars>0&&(p.charRefs>0||p.locked>0);
  const genDone=scriptDone&&p.gen>=p.clips&&p.clips>0;
  const editDone=genDone&&p.approved>=p.clips;
  const text=scriptEditorText?scriptEditorText():state.scriptText||'';
  $('stepScriptMeta').textContent=scriptDone
    ?(text?text.split(/\r?\n/).length+' lines · ':'')+p.clips+' clips parsed'
    :'Import or paste to start';
  $('stepCastMeta').textContent=scriptDone
    ?p.chars+' cast ('+p.charRefs+' with refs) · '+p.locs+' locations ('+p.locked+' locked)'
    :'—';
  $('stepGenMeta').textContent=scriptDone?p.gen+' / '+p.clips+' generated':'—';
  $('stepEditMeta').textContent=scriptDone?p.approved+' approved':'—';
  const states={script:scriptDone,cast:castDone,generate:genDone,edit:editDone};
  let currentSet=false;
  bar.querySelectorAll('.step').forEach(el=>{
    const done=!!states[el.dataset.step];
    el.classList.toggle('done',done);
    const isCurrent=!done&&!currentSet;
    if(isCurrent)currentSet=true;
    el.classList.toggle('current',isCurrent);
  });
}
function openModulePanel(label){
  let found=null;
  document.querySelectorAll('.module-panel').forEach(panel=>{
    const sum=panel.querySelector('summary');
    if(sum&&sum.textContent.trim()===label){panel.open=true;found=panel}
  });
  if(found)found.scrollIntoView({behavior:'smooth',block:'start'});
}
function gotoStep(step){
  if(step==='script'){openScriptPanel();return}
  if(step==='cast'){openModulePanel('Characters');openModulePanel('Locations');return}
  if(step==='generate'){
    if(!state.clips.length)return toast('Parse a script first');
    if(!state.selectedId)state.selectedId=state.clips[0].id;
    renderAll();
    const ts=$('timelineSection');if(ts)ts.scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
  if(step==='edit'){openModulePanel('Editor');openModulePanel('Export')}
}

/* ── sign-in gating (visible, not a silent toast) ── */
function renderAuthGate(){
  const gate=$('authGate');if(!gate)return;
  gate.classList.toggle('hidden',!!curUser);
  ['btnGen','btnRegen','btnBatch','btnUpscaleAll'].forEach(id=>{const b=$(id);if(b)b.disabled=!curUser});
  const clip=state.clips.find(c=>c.id===state.selectedId);
  const ap=$('btnApprove');
  if(ap)ap.disabled=!clip||!clip.videoUrl;
  const up=$('btnUpscale');
  if(up){
    up.disabled=!curUser||!clip||!clip.videoUrl||!!(clip&&clip.upscaled);
    up.textContent=(clip&&clip.upscaled)?'✓ Upscaled':'⬆ Upscale';
  }
  const gen=$('btnGen');
  if(gen)gen.title=curUser?'':'Sign in to generate';
}
function openSidePanelsIfNeeded(){
  if(!state.clips.length)return;
  document.querySelectorAll('.module-panel').forEach(panel=>{
    const sum=panel.querySelector('summary');
    const label=sum?sum.textContent.trim():'';
    if(label==='Characters'||label==='Locations')panel.open=true;
  });
}
function ensureShotOneLocation(){
  if(!state.clips.length)return false;
  const scenes=state.parseResult&&state.parseResult.scenes;
  if(!scenes||!scenes.length)return false;
  const clip=state.clips[0];
  const heading=scenes[0].heading||'';
  const loc=canonicalLocName(
    SBParser.inferLocation?SBParser.inferLocation(heading):
    (SBParser.parseSceneHeading?SBParser.parseSceneHeading(heading).name:'')
  );
  if(!loc)return false;
  ensureClip(clip);
  let changed=false;
  if(clip.sceneIdx==null){clip.sceneIdx=0;changed=true}
  const raw=getClipLocationRaw(clip);
  if(!raw||raw==='SCENE 1'||/^at\s+/i.test(raw)){
    clip.params.scene.location=loc;changed=true;
  }
  if(heading&&heading!=='SCENE 1'&&(!clip.heading||clip.heading==='SCENE 1')){
    clip.heading=heading;changed=true;
  }
  if(changed)save();
  return changed;
}

function backfillClipLocationsFromParse(){
  const scenes=state.parseResult&&state.parseResult.scenes;
  if(!scenes||!state.clips.length)return;
  let changed=false;
  state.clips.forEach(clip=>{
    const si=clip.sceneIdx;
    if(si==null||!scenes[si])return;
    const heading=scenes[si].heading||'';
    const loc=SBParser.inferLocation?SBParser.inferLocation(heading):(SBParser.parseSceneHeading?SBParser.parseSceneHeading(heading).name:'');
    ensureClip(clip);
    const cleanLoc=loc?canonicalLocName(String(loc).replace(/^\s*(?:at|in|on|inside|outside|near)\s+(?:the\s+)?/i,'').trim()):'';
    if(cleanLoc&&(!clip.params.scene.location||clip.params.scene.location===''||/^at\s+/i.test(clip.params.scene.location))){
      clip.params.scene.location=cleanLoc;changed=true;
    }
    if(heading&&heading!=='SCENE 1'&&(!clip.heading||clip.heading==='SCENE 1')){
      clip.heading=heading;changed=true;
    }
  });
  if(changed)save();
  ensureShotOneLocation();
}
function syncLocationBibleFromClips(){
  bootstrapLocationsInline();
  if(window.SBLocations&&typeof SBLocations.syncAll==='function'){
    try{state.locationBible=SBLocations.syncAll(state)}catch(e){}
  }
  if(state.selectedLoc&&!state.locationBible.some(l=>l.key===state.selectedLoc)){
    state.selectedLoc=state.locationBible.length?state.locationBible[0].key:null;
  }
  return true;
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
  if(trimmed){
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
  const step=$('stepScriptMeta');
  if(step){
    if(!text.trim())step.textContent=state.clips.length?state.clips.length+' clips parsed':'Import or paste to start';
    else if(isClipReconstruction(text))step.textContent='⚠ Corrupted clip text — use + New script in the editor';
    else if(SBParser.isScriptFlattened&&SBParser.isScriptFlattened(text))step.textContent='⚠ Flattened script — click Unflatten in the editor';
    else step.textContent=summary;
  }
}

function rebuildScriptFromParse(){
  const scenes=state.parseResult&&state.parseResult.scenes;
  if(!scenes||!scenes.length)return'';
  const parts=[];
  scenes.forEach(function(sc){
    if(sc.heading)parts.push(String(sc.heading).trim());
    (sc.shots||[]).forEach(function(sh){
      if(sh.description)parts.push(String(sh.description).trim());
      if(sh.dialogue){
        const cue=(sh.characters_in_frame&&sh.characters_in_frame[0])||'';
        if(cue)parts.push(String(cue).toUpperCase().trim());
        parts.push(String(sh.dialogue).trim());
      }
    });
    parts.push('');
  });
  return parts.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

async function recoverCorruptScript(){
  const rebuilt=rebuildScriptFromParse();
  if(!rebuilt||rebuilt.length<80){
    toast('No parse data to recover from — import your .txt / .pdf / .fdx file');
    openScriptPanel();
    return false;
  }
  pushHistory();
  state.scriptText=rebuilt;
  const ta=$('scriptEditor');
  if(ta){ta.value=rebuilt;ta._focused=false}
  save();
  renderScriptWarn(rebuilt);
  updateScriptMeta();
  if(isClipReconstruction(rebuilt)){
    toast('Recovery still looks thin — best fix is re-importing your original screenplay file');
    return false;
  }
  await importText(rebuilt,{fromRecovery:true});
  toast('Recovered screenplay from parse — review in script editor');
  return true;
}

function renderScriptWarn(text){
  const el=$('scriptWarn');
  if(!el)return;
  const corrupt=isClipReconstruction(text);
  if(corrupt){
    el.classList.remove('hidden');
    const canRecover=!!(state.parseResult&&state.parseResult.scenes&&state.parseResult.scenes.length);
    el.innerHTML='<strong>Not your original screenplay.</strong> This box has broken clip-reconstruction text. '+
      (canRecover?'<button type="button" class="tb-btn gold" id="btnRecoverScript" style="margin:8px 8px 0 0">↻ Recover from parse</button>':'')+
      ' Or click <strong>+ New script</strong> and re-import your .txt / .pdf / .fdx.';
    const btn=$('btnRecoverScript');
    if(btn)btn.onclick=function(){recoverCorruptScript()};
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
    const blob=state.scriptText||'';
    if(blob&&ta.value!==blob)ta.value=blob;
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

// Scene-block bands under the ruler: one colored segment per continuity block,
// sized to span its clips, so the film strip also reads as scene structure.
// Walks the clips (not the block list) so every clip is covered even when the
// continuity graph is partial.
function renderSceneBands(){
  const el=$('sceneBands');if(!el)return;
  const CARD=108,GAP=6;
  const segs=[];
  state.clips.forEach((c,i)=>{
    let key='i:'+i,label='Scene',tod='';
    let blk=null;
    if(window.SBContinuity&&typeof SBContinuity.blockForClip==='function'){
      try{blk=SBContinuity.blockForClip(state,i)}catch(e){}
    }
    if(blk){
      key='b:'+(blk.id!=null?blk.id:blk.locationKey);
      label=blk.locationName||blk.locationKey||'Scene';
      tod=blk.timeOfDay||'';
    }else if(window.SBLocations){
      const meta=SBLocations.clipLocationMeta(c)||{};
      if(meta.key){key='l:'+meta.key;label=meta.name||'Scene'}
    }
    const last=segs[segs.length-1];
    if(last&&last.key===key)last.count++;
    else segs.push({key,label,tod,count:1,firstClip:i});
  });
  el.innerHTML=segs.map((s,i)=>{
    const w=s.count*(CARD+GAP)-GAP;
    const hue=(String(s.label).split('').reduce((h,ch)=>((h*31+ch.charCodeAt(0))>>>0),7)%360);
    const short=String(s.label).length>26?String(s.label).slice(0,24)+'…':s.label;
    return '<span class="scene-band" data-clip="'+s.firstClip+'" style="width:'+w+'px;--band:hsl('+hue+',45%,48%)" title="'+esc(s.label)+(s.tod?' — '+esc(s.tod):'')+'">'+esc(short)+(s.tod?' <span class="band-tod">'+esc(s.tod)+'</span>':'')+'</span>';
  }).join('');
  el.querySelectorAll('.scene-band').forEach(b=>{
    b.onclick=()=>{const c=state.clips[parseInt(b.dataset.clip,10)];if(c){state.selectedId=c.id;renderAll()}};
  });
}

function renderTimeline(){
  const has=state.clips.length>0;
  $('importZone').classList.toggle('hidden',has);
  $('timelineSection').classList.toggle('hidden',!has);
  if(!has){$('clipRow').innerHTML='';$('timeRuler').innerHTML='';if($('sceneBands'))$('sceneBands').innerHTML='';return}
  let t=0,ticks=[];
  state.clips.forEach(c=>{ticks.push('<span class="time-tick">'+formatTime(t)+'</span>');t+=clipDur(c)});
  ticks.push('<span class="time-tick">'+formatTime(t)+'</span>');
  $('timeRuler').innerHTML=ticks.join('');
  renderSceneBands();
  $('clipRow').innerHTML=state.clips.map(c=>{
    const st=c.status==='approved'?'approved':c.status==='done'?'done':c.status==='generating'?'gen':'';
    const th=c.videoUrl?'<video src="'+c.videoUrl+'" muted loop playsinline></video>':'<span class="ph">🎬</span>';
    const vd=(window.SBVerify&&SBVerify.verdict(c))||'';
    const vTitle=vd?esc(SBVerify.summaryText(c)):'';
    return '<div class="clip-card'+(c.id===state.selectedId?' active':'')+(c.status==='approved'?' approved':'')+'" data-id="'+c.id+'" draggable="true"><div class="verify-dot '+vd+'" title="'+vTitle+'"></div><div class="clip-status '+st+'"></div><div class="clip-num">Clip '+String(c.num).padStart(2,'0')+'</div><div class="clip-thumb">'+th+'</div><div class="clip-label">'+esc(c.label)+'</div><div class="clip-dur">~'+c.durationSec+'s</div></div>';
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
  let locHint='';
  if(window.SBLocations){
    const meta=SBLocations.clipLocationMeta(clip);
    const locEntry=(state.locationBible||[]).find(l=>l.key===meta.key);
    if(locEntry&&locEntry.locked){
      locHint='<div class="hint-chip gold">🔒 Location locked: <strong>'+esc(locEntry.name)+'</strong>'+(locEntry.plateUrl?' · plate attached':'')+'</div>';
    }else if(meta.name){
      locHint='<div class="hint-chip bare">📍 '+esc(meta.name)+' — lock in <strong>Locations</strong> panel below timeline</div>';
    }
  }
  if(window.SBContinuity&&typeof SBContinuity.blockForClip==='function'){
    const ci=state.clips.findIndex(c=>c.id===clip.id);
    const blk=SBContinuity.blockForClip(state,ci);
    if(blk){
      const cast=[].concat(blk.leads||[],blk.supporting||[],blk.background||[]).filter(Boolean);
      const castPreview=cast.slice(0,6).join(', ')+(cast.length>6?'…':'');
      locHint+='<div class="hint-chip quiet">🔗 Scene block · '+esc(blk.continuity||'new')+
        (blk.locationName?' · <strong>'+esc(blk.locationName)+'</strong>':'')+
        (castPreview?' · cast: '+esc(castPreview):'')+'</div>';
    }
  }
  let verifyHint='';
  if(window.SBVerify&&clip.continuity&&clip.continuity.available){
    const vd=SBVerify.verdict(clip);
    verifyHint='<div class="hint-chip '+(vd==='good'?'quiet':'gold')+'"><span class="verify-scores"><span class="'+vd+'">●</span> Continuity: '+esc(SBVerify.summaryText(clip))+'</span>'+
      (vd==='bad'?' <button type="button" class="tb-btn" id="btnRegenIdentity" style="margin-left:6px;padding:2px 8px;font-size:10px">↻ Regenerate (identity refs)</button>':'')+'</div>';
  }
  body.innerHTML=locHint+verifyHint+
    '<div class="field"><label>Scene</label><textarea id="d-desc" rows="3">'+esc(clip.description)+'</textarea></div>'+
    '<div class="field"><label>Emotion</label><select id="d-emotion">'+['Neutral','Tense','Joy','Fear','Anger','Sad','Noir'].map(e=>'<option'+(clip.emotion===e?' selected':'')+'>'+e+'</option>').join('')+'</select></div>'+
    '<details class="detail-section"><summary>AI prompt</summary><div class="section-inner"><textarea id="d-prompt" readonly rows="4">'+esc(buildPrompt(clip))+'</textarea></div></details>'+
    '<details class="detail-section"><summary>Scene &amp; setting</summary><div class="section-inner">'+mkTog(p.scene,'location','Location')+mkTog(p.scene,'timeOfDay','Time')+mkTog(p.scene,'weather','Weather')+mkTog(p.scene,'season','Season')+'</div></details>'+
    '<details class="detail-section"><summary>Camera</summary><div class="section-inner">'+mkTog(p.camera,'angle','Angle')+mkTog(p.camera,'filmGrade','Film grade')+mkTog(p.camera,'colorMode','Color')+mkTog(p.camera,'saturation','Saturation')+'</div></details>'+
    '<details class="detail-section"><summary>Atmosphere</summary><div class="section-inner">'+mkTog(p.atmosphere,'lighting','Lighting')+mkTog(p.atmosphere,'mood','Mood')+mkTog(p.atmosphere,'fx','FX')+mkTog(p.atmosphere,'sound','Sound')+'</div></details>'+
    (clip.error?'<div class="err">'+esc(clip.error)+'</div>':'');
  const regenId=$('btnRegenIdentity');
  if(regenId)regenId.onclick=()=>{clip.retryCount=(clip.retryCount||0)+1;clip._forceIdentity=true;runJob(clip)};
  $('d-desc').oninput=e=>{clip.description=e.target.value;save();const pr=$('d-prompt');if(pr)pr.value=buildPrompt(clip)};
  $('d-emotion').onchange=e=>{clip.emotion=e.target.value;save();const pr=$('d-prompt');if(pr)pr.value=buildPrompt(clip)};
  body.querySelectorAll('.toggle').forEach(t=>{t.onclick=()=>{const g=clip.params[t.dataset.grp];g.on[t.dataset.f]=!g.on[t.dataset.f];t.classList.toggle('on',g.on[t.dataset.f]);save();const pr=$('d-prompt');if(pr)pr.value=buildPrompt(clip)}});
  body.querySelectorAll('input[data-grp]').forEach(inp=>{inp.oninput=()=>{clip.params[inp.dataset.grp][inp.dataset.f]=inp.value;save();const pr=$('d-prompt');if(pr)pr.value=buildPrompt(clip)}});
}
function mkTog(grp,f,label){return '<div class="field"><label><span>'+label+'</span><span class="toggle'+(grp.on[f]?' on':'')+'" data-grp="'+(['location','timeOfDay','weather','season'].includes(f)?'scene':['angle','filmGrade','colorMode','saturation'].includes(f)?'camera':'atmosphere')+'" data-f="'+f+'"></span></label><input data-grp="'+(['location','timeOfDay','weather','season'].includes(f)?'scene':['angle','filmGrade','colorMode','saturation'].includes(f)?'camera':'atmosphere')+'" data-f="'+f+'" value="'+esc(grp[f]||'')+'"></div>'}

function clipsForEditor(){
  const withVideo=state.clips.filter(c=>c.videoUrl);
  const approved=withVideo.filter(c=>c.status==='approved');
  return approved.length?approved:withVideo;
}
function initTimelineEditor(){
  if(timelineEditorInst||!window.SBTimelineEditor||!$('tle-binItems'))return;
  timelineEditorInst=window.SBTimelineEditor.create({
    prefix:'tle-',
    storageKey:'SB_Editor_embed_v1',
    embedded:true,
    projectName:state.projectName
  });
  timelineEditorInst.init({onSync:syncTimelineEditor,onProCut:runProCut});
}
async function runProCut(){
  if(!window.SBProCut)return toast('Pro Cut module not loaded — hard refresh');
  const ok=clipsForEditor();
  if(!ok.length)return toast('Generate clips first');
  const panel=$('editorPanel');
  if(panel)panel.open=true;
  if(!timelineEditorInst)initTimelineEditor();
  const log=$('tle-agentLog');
  const prog=(msg)=>{if(log){const line=document.createElement('div');line.className='line info';line.textContent=msg;log.appendChild(line);log.scrollTop=log.scrollHeight}};
  const btn=$('tle-btnProCut');
  if(btn)btn.disabled=true;
  try{
    prog('Pro Cut starting…');
    const result=await SBProCut.run(ok,{
      projectName:state.projectName,
      onProgress:prog,
    });
    SBProCut.applyToTimelineClips(state.clips,result.edl);
    save();
    if(timelineEditorInst)await timelineEditorInst.applyProCut(result.edl);
    toast('Pro Cut ready — review track, then Render MP4');
  }catch(e){
    toast(e.message||'Pro Cut failed');
    prog('Pro Cut failed: '+(e.message||e));
  }
  if(btn)btn.disabled=false;
}
function syncTimelineEditor(){
  if(!timelineEditorInst)initTimelineEditor();
  if(!timelineEditorInst)return toast('Editor not ready');
  const ok=clipsForEditor();
  if(!ok.length)return toast('Generate clips first');
  if(!state.clips.filter(c=>c.status==='approved'&&c.videoUrl).length)toast('Using unapproved clips — approve for final export');
  timelineEditorInst.syncFromClips(ok,{clipDuration:clipDur});
}
function openEditorPanel(){
  const panel=$('editorPanel');
  if(panel)panel.open=true;
  syncTimelineEditor();
}
function renderAssembly(){
  const hint=$('tle-syncHint');
  if(!hint)return;
  const n=state.clips.filter(c=>c.videoUrl).length;
  const a=state.clips.filter(c=>c.status==='approved'&&c.videoUrl).length;
  hint.textContent=n?(a?a+' approved · '+n+' with video — Pro Cut or Sync':'No approved clips — Pro Cut uses all generated clips'):'Generate clips, then Pro Cut';
}

function deleteCharacter(name){
  const up=String(name||'').trim();
  if(!up||!state.characters[up])return;
  if(!confirm('Delete "'+up+'"? They will be removed from the character list and all clips.'))return;
  pushHistory();
  delete state.characters[up];
  state.clips.forEach(c=>{
    if(!c.characters)return;
    c.characters=c.characters.filter(n=>String(n).toUpperCase().trim()!==up);
  });
  const remaining=Object.keys(state.characters);
  state.selectedChar=remaining.includes(state.selectedChar)?state.selectedChar:(remaining[0]||null);
  save();
  renderCharacters();
  renderTimeline();
  toast('Deleted '+up);
}

function renderCharacters(){
  let listHtml=SBCharacters.renderList(state.characters,state.selectedChar);
  if(!Object.keys(state.characters).length&&state.clips.length){
    listHtml='<div class="callout"><strong>Characters empty</strong> — click <strong>↻ Sync from parse</strong> or <strong>re-import</strong> your script (Import / Paste). Names must be in screenplay format (ALL CAPS cue lines or <em>Name: dialogue</em>).</div>'+listHtml;
  }
  $('charListPanel').innerHTML=listHtml;
  $('charListPanel').querySelectorAll('.char-card').forEach(el=>{
    el.onclick=()=>{state.selectedChar=el.dataset.name;renderCharacters()};
  });
  $('charListPanel').querySelectorAll('.char-del').forEach(btn=>{
    btn.onclick=e=>{e.stopPropagation();deleteCharacter(btn.dataset.del)};
  });
  const stripNames=charsForStrip();
  if($('charsStrip'))$('charsStrip').classList.toggle('hidden',!stripNames.length);
  $('charChips').innerHTML=stripNames.map(n=>'<span class="char-chip">'+esc(n)+'</span>').join('');
  renderCharEditor();
}
function outfitListHtml(c){
  const outfits=(c&&c.outfits)||[];
  if(!outfits.length)return'';
  const rows=outfits.map(o=>'<div class="outfit-row">'+
    (o.cardUrl?'<img class="outfit-card" src="'+esc(o.cardUrl)+'" alt="">':'')+
    '<span class="outfit-scene">Scene '+(o.sceneIdx+1)+'</span>'+
    '<span class="outfit-desc">'+esc(o.description||'')+'</span>'+
    '</div>').join('');
  return '<div class="field"><label>Outfit timeline (per-scene wardrobe)</label><div class="outfit-list">'+rows+'</div></div>';
}
function renderCharEditor(){
  let html=SBCharacters.renderEditor(state.selectedChar,state.selectedChar?state.characters[state.selectedChar]:null);
  const c=state.selectedChar?state.characters[state.selectedChar]:null;
  if(c&&window.SBRefKit){
    // Kit strip + outfit timeline slot in before the action buttons (end of the editor card).
    html=html.replace('<button type="button" class="tb-btn gold" id="btnGenPortrait">',SBRefKit.renderCharKitHtml(c)+outfitListHtml(c)+'<button type="button" class="tb-btn gold" id="btnGenPortrait">');
  }
  $('charEditorPanel').innerHTML=html;
  if(!state.selectedChar)return;
  const kitBtn=$('btnBuildCharKit');if(kitBtn)kitBtn.onclick=()=>buildCharKit(state.selectedChar);
  $('charEditorPanel').querySelectorAll('.kit-regen').forEach(b=>{b.onclick=()=>regenCharKitView(state.selectedChar,b.dataset.kitView)});
  $('charEditorPanel').querySelectorAll('[data-k]').forEach(el=>{
    const k=el.dataset.k;
    if(el.classList.contains('toggle')){el.onclick=()=>{pushHistory();c[k]=!c[k];el.classList.toggle('on',c[k]);save();renderCharacters()};return}
    el.oninput=el.onchange=()=>{
      c[k]=el.value;
      if(k==='description')c._descLocked=true;
      if(k==='wardrobe')c._wardrobeLocked=true;
      save();
    };
  });
  const gen=$('btnGenPortrait');if(gen)gen.onclick=()=>generateCharPortrait(state.selectedChar);
  const up=$('btnUploadRef');if(up)up.onclick=()=>uploadRef(state.selectedChar);
  const clr=$('btnClearRef');if(clr)clr.onclick=()=>{pushHistory();c.refUrl=null;save();renderCharacters()};
  const del=$('btnDeleteChar');if(del)del.onclick=()=>deleteCharacter(state.selectedChar);
}
// Refs must land on real https hosting (Firebase Storage) — the resolvers drop
// data: URLs, so anything short of a hosted URL never reaches the video providers.
async function hostRefImage(fileOrDataUrl,path){
  if(!window.SBStorage||!SBStorage.ready())throw new Error('Image hosting unavailable — refresh the page (Storage SDK missing)');
  return SBStorage.uploadDataUrl(fileOrDataUrl,path);
}

// In-timeline AI reference generation (ports app.html's Character Studio here) —
// generate_picture returns a hosted https URL synchronously.
async function generatePicture(opts){
  const r=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:await hdrs(),body:JSON.stringify(Object.assign({action:'generate_picture',model:'nano-banana-pro'},opts))});
  const d=await r.json();
  if(!r.ok||!d.url)throw new Error(d.detail||d.error||'Image generation failed');
  return d.url;
}
async function generateCharPortrait(name){
  const c=state.characters[name];if(!c)return;
  if(!curUser)return toast('Sign in to generate');
  const desc=(c.description||'').trim();
  if(!desc)return toast('Add a description first — the portrait is generated from it');
  toast('Generating portrait for '+name+'…');
  try{
    const url=await generatePicture({
      type:'character',name,
      desc:'Character reference portrait, front view, chest-up, neutral expression, even soft lighting, plain dark backdrop. '+desc+(c.wardrobe?' Wearing: '+c.wardrobe+'.':''),
      aspect_ratio:'2:3'
    });
    pushHistory();c.refUrl=url;save();renderCharacters();toast('Portrait locked for '+name);
  }catch(e){toast(e.message)}
}
async function generateLocPlate(locKey){
  const loc=(state.locationBible||[]).find(l=>l.key===locKey);if(!loc)return;
  if(!curUser)return toast('Sign in to generate');
  toast('Generating plate for '+loc.name+'…');
  try{
    const url=await generatePicture({
      type:'location',name:loc.name,
      desc:'Location reference plate, wide establishing view, no people. '+(loc.description||loc.name)+(loc.consistencyPhrase?' '+loc.consistencyPhrase:''),
      aspect_ratio:'16:9'
    });
    pushHistory();loc.plateUrl=url;loc.locked=true;save();renderLocations();toast('Plate locked for '+loc.name);
  }catch(e){toast(e.message)}
}

/* ── reference kits (turnarounds / angle plates via SBRefKit) ── */
async function buildCharKit(name){
  const c=state.characters[name];if(!c||!window.SBRefKit)return;
  if(!curUser)return toast('Sign in to generate');
  if(!(c.description||'').trim())return toast('Add a description first — the kit is generated from it');
  toast('Building reference kit for '+name+' (4 views)…');
  try{
    await SBRefKit.buildCharacterKit(name,c,generatePicture,(view)=>{save();renderCharacters();toast(name+': '+view+' ready')});
    c.lockMethod='kit';save();renderCharacters();
    toast('Reference kit complete — '+name+' now locks per shot type');
  }catch(e){save();renderCharacters();toast(e.message)}
}
async function buildLocKit(locKey){
  const loc=(state.locationBible||[]).find(l=>l.key===locKey);if(!loc||!window.SBRefKit)return;
  if(!curUser)return toast('Sign in to generate');
  toast('Building location kit for '+loc.name+' (3 angles)…');
  try{
    await SBRefKit.buildLocationKit(loc,generatePicture,(view)=>{save();renderLocations();toast(loc.name+': '+view+' ready')});
    loc.locked=true;save();renderLocations();
    toast('Location kit complete for '+loc.name);
  }catch(e){save();renderLocations();toast(e.message)}
}
async function regenCharKitView(name,view){
  const c=state.characters[name];if(!c||!window.SBRefKit)return;
  if(!curUser)return toast('Sign in to generate');
  toast('Regenerating '+view+'…');
  try{await SBRefKit.regenerateCharView(name,c,view,generatePicture);save();renderCharacters();toast(view+' updated')}
  catch(e){toast(e.message)}
}
async function regenLocKitView(locKey,view){
  const loc=(state.locationBible||[]).find(l=>l.key===locKey);if(!loc||!window.SBRefKit)return;
  if(!curUser)return toast('Sign in to generate');
  toast('Regenerating '+view+'…');
  try{await SBRefKit.regenerateLocView(loc,view,generatePicture);save();renderLocations();toast(view+' updated')}
  catch(e){toast(e.message)}
}
async function uploadRef(name){
  const inp=document.createElement('input');inp.type='file';inp.accept='image/*';
  inp.onchange=async()=>{const f=inp.files[0];if(!f)return;try{
    toast('Uploading reference…');
    const url=await hostRefImage(f,'refs/char-'+name);
    pushHistory();state.characters[name].refUrl=url;save();renderCharacters();toast('Reference locked for '+name);
  }catch(e){toast(e.message)}};
  inp.click();
}

function renderLocations(){
  const bible=state.locationBible||[];
  let listHtml=window.SBLocations?SBLocations.renderList(bible,state.selectedLoc):
    (bible.length?'<div class="loc-grid">'+bible.map(l=>'<div class="loc-card'+(state.selectedLoc===l.key?' selected':'')+'" data-key="'+esc(l.key)+'"><div class="loc-name">'+esc(l.name)+'</div><div class="loc-meta">'+(l.clipIndices||[]).length+' clips</div></div>').join('')+'</div>':
    '<div class="empty-hint">No locations — click ↻ Sync from clips</div>');
  if(!bible.length&&state.clips.length){
    listHtml='<div class="callout"><strong>No locations yet</strong> — click <strong>↻ Sync from clips</strong> (scene headings from your parse).</div>'+listHtml;
  }
  const listEl=$('locListPanel');
  if(listEl){
    listEl.innerHTML=listHtml;
    listEl.querySelectorAll('.loc-card').forEach(el=>{
      el.onclick=()=>{state.selectedLoc=el.dataset.key;renderLocations()};
    });
  }
  const locked=window.SBLocations?SBLocations.lockedNames(bible):(bible||[]).filter(l=>l&&l.locked&&l.name).map(l=>l.name);
  if($('locsStrip'))$('locsStrip').classList.toggle('hidden',!locked.length);
  if($('locChips'))$('locChips').innerHTML=locked.map(n=>'<span class="char-chip on">🔒 '+esc(n)+'</span>').join('');
  renderLocEditor();
}
function renderLocEditor(){
  const panel=$('locEditorPanel');
  if(!panel)return;
  if(!window.SBLocations){
    const loc=state.selectedLoc?(state.locationBible||[]).find(l=>l.key===state.selectedLoc):null;
    panel.innerHTML=loc?'<div class="loc-editor"><h4>📍 '+esc(loc.name)+'</h4><p style="font-size:12px;color:var(--dim)">'+esc(loc.description||'')+'</p></div>':'<div class="empty-hint">Select a location</div>';
    return;
  }
  const loc=state.selectedLoc?(state.locationBible||[]).find(l=>l.key===state.selectedLoc):null;
  let locHtml=SBLocations.renderEditor(state.selectedLoc,loc);
  if(loc&&window.SBRefKit){
    locHtml=locHtml.replace('<button type="button" class="tb-btn gold" id="btnGenLocPlate">',SBRefKit.renderLocKitHtml(loc)+'<button type="button" class="tb-btn gold" id="btnGenLocPlate">');
  }
  panel.innerHTML=locHtml;
  if(!loc)return;
  const kitBtn=$('btnBuildLocKit');if(kitBtn)kitBtn.onclick=()=>buildLocKit(state.selectedLoc);
  panel.querySelectorAll('.kit-regen').forEach(b=>{b.onclick=()=>regenLocKitView(state.selectedLoc,b.dataset.kitView)});
  panel.querySelectorAll('[data-k]').forEach(el=>{
    const k=el.dataset.k;
    if(el.classList.contains('toggle')){
      el.onclick=()=>{pushHistory();loc.locked=!loc.locked;el.classList.toggle('on',loc.locked);save();renderLocations();renderDetail();toast(loc.locked?'Location locked: '+loc.name:'Location unlocked: '+loc.name)};
      return;
    }
    el.oninput=el.onchange=()=>{loc[k]=el.value;save();const pr=$('d-prompt');if(pr&&state.selectedId){const c=state.clips.find(x=>x.id===state.selectedId);if(c)pr.value=buildPrompt(c)}};
  });
  const genP=$('btnGenLocPlate');if(genP)genP.onclick=()=>generateLocPlate(state.selectedLoc);
  const up=$('btnUploadLocPlate');if(up)up.onclick=()=>uploadLocPlate(state.selectedLoc);
  const clr=$('btnClearLocPlate');if(clr)clr.onclick=()=>{pushHistory();loc.plateUrl=null;save();renderLocations();toast('Plate removed')};
}
async function uploadLocPlate(locKey){
  const loc=(state.locationBible||[]).find(l=>l.key===locKey);
  if(!loc)return toast('Select a location first');
  const inp=document.createElement('input');inp.type='file';inp.accept='image/*';
  inp.onchange=async()=>{const f=inp.files[0];if(!f)return;try{
    toast('Uploading plate…');
    const url=await hostRefImage(f,'refs/loc-'+locKey);
    pushHistory();loc.plateUrl=url;loc.locked=true;save();renderLocations();toast('Location plate set for '+loc.name);
  }catch(e){toast(e.message)}};
  inp.click();
}

function renderOutput(){$('queuePanel').innerHTML=SBExport.renderQueue(state.clips,state.queue);$('outputStats').textContent=state.clips.filter(c=>c.status==='approved').length+' approved · '+state.clips.filter(c=>c.videoUrl).length+' rendered'}

/* ── props panel ── */
function renderProps(){
  const listEl=$('propListPanel');
  if(!listEl||!window.SBProps)return;
  listEl.innerHTML=SBProps.renderList(state.propBible,state.selectedProp);
  listEl.querySelectorAll('[data-prop]').forEach(el=>{
    el.onclick=()=>{state.selectedProp=el.dataset.prop;renderProps()};
  });
  const rules=state.continuityRules;
  const meta=$('continuityRuleMeta');
  if(meta)meta.textContent=rules?('rules: '+rules.source+' · '+(rules.crowds||[]).length+' crowd · '+(rules.anchors||[]).length+' anchor'):'rules: default';
  renderPropEditor();
}
function renderPropEditor(){
  const panel=$('propEditorPanel');
  if(!panel||!window.SBProps)return;
  const prop=state.selectedProp?(state.propBible||[]).find(p=>p.id===state.selectedProp):null;
  panel.innerHTML=SBProps.renderEditor(prop);
  if(!prop)return;
  panel.querySelectorAll('[data-pk]').forEach(el=>{
    const k=el.dataset.pk;
    el.oninput=el.onchange=()=>{prop[k]=el.value;save();renderProps()};
  });
  const gen=$('btnGenPropCard');if(gen)gen.onclick=()=>generatePropCard(prop.id);
  const del=$('btnDeleteProp');if(del)del.onclick=()=>{
    pushHistory();state.propBible=(state.propBible||[]).filter(p=>p.id!==prop.id);
    state.selectedProp=null;save();renderProps();toast('Prop deleted');
  };
}
function addProp(){
  if(!window.SBProps)return;
  pushHistory();
  if(!state.propBible)state.propBible=[];
  const p=SBProps.ensureProp({name:'New prop',description:'',refUrl:null,heldBy:''});
  state.propBible.push(p);
  state.selectedProp=p.id;
  save();renderProps();
}
async function generatePropCard(propId){
  const prop=(state.propBible||[]).find(p=>p.id===propId);if(!prop)return;
  if(!curUser)return toast('Sign in to generate');
  if(!(prop.description||'').trim())return toast('Add a description first');
  toast('Generating prop card for '+prop.name+'…');
  try{
    const url=await generatePicture({
      type:'prop',name:prop.name,
      desc:'Product-style reference card for a film prop, plain neutral background, no people, no hands. '+prop.name+': '+prop.description,
      aspect_ratio:'1:1'
    });
    pushHistory();prop.refUrl=url;save();renderProps();toast('Prop card ready for '+prop.name);
  }catch(e){toast(e.message)}
}
async function enrichContinuity(){
  if(!window.SBProps)return;
  if(!curUser)return toast('Sign in to run continuity enrichment');
  if(!(state.scriptText||'').trim())return toast('Import a script first');
  toast('Analyzing script for props, outfits, and crowd/location rules…');
  try{
    const h=await hdrs();
    const data=await SBProps.enrich(state,h);
    pushHistory();
    const n=SBProps.mergeEnrichResult(state,data);
    if(window.SBContinuity&&typeof SBContinuity.applyGraph==='function')SBContinuity.applyGraph(state);
    save();renderAll();
    toast(n?('Continuity enrich: '+(state.propBible||[]).length+' props, rules updated'):'No new continuity data found');
  }catch(e){toast(e.message)}
}

function isValidCharacterName(name){
  const up=String(name||'').toUpperCase().trim();
  if(!up||up.length<2)return false;
  if(SBParser.isCastMember)return SBParser.isCastMember(up);
  if(SBParser.isLikelyPersonName)return SBParser.isLikelyPersonName(up,{fromCue:true});
  return !JUNK_CHAR_WORDS.has(up)&&!CHAR_SKIP.has(up);
}

function scriptForCastExtraction(){
  return extractionText();
}

function inferCastRole(name,clips){
  const up=String(name||'').toUpperCase().trim().replace(/^(A|AN|THE)\s+/,'');
  const words=up.split(/\s+/).filter(Boolean);
  let hasDialogue=false;
  (clips||[]).forEach(c=>{
    if(!c.dialogue)return;
    const inFrame=(c.characters||[]).some(n=>String(n).toUpperCase().trim()===up);
    if(inFrame)hasDialogue=true;
  });
  if(words.length>=2)return hasDialogue?'supporting':'background';
  if(hasDialogue)return'lead';
  return'supporting';
}

function applyCastRoles(characters,clips){
  if(!characters)return;
  Object.keys(characters).forEach(name=>{
    const c=characters[name];
    if(!c||c.role&&c.role!=='lead')return;
    c.role=inferCastRole(name,clips);
  });
}

function collectCastFromProject(){
  const chars={};
  const add=(name,desc)=>{
    const up=String(name||'').replace(/\s*\([^)]*\)\s*/g,'').trim().toUpperCase();
    if(!up||!isValidCharacterName(up))return;
    if(chars[up]===undefined)chars[up]=desc||'';
    else if(desc&&String(desc).length>String(chars[up]).length)chars[up]=desc;
  };
  if(state.parseResult&&state.parseResult.characters){
    Object.entries(state.parseResult.characters).forEach(([n,d])=>add(n,d));
  }
  if(state.parseResult&&state.parseResult.scenes){
    state.parseResult.scenes.forEach(sc=>{
      (sc.shots||[]).forEach(sh=>{
        (sh.characters_in_frame||[]).forEach(n=>add(n,''));
      });
    });
  }
  state.clips.forEach(c=>{
    (c.characters||[]).forEach(n=>add(n,''));
    const desc=String(c.description||'');
    const closeM=desc.match(/Close on\s+([A-Z][A-Z0-9 .'\-]{1,30})/i);
    if(closeM)add(closeM[1],'');
  });
  const script=scriptForCastExtraction();
  if(script&&SBParser.extractCharactersFromText){
    Object.entries(SBParser.extractCharactersFromText(script)).forEach(([n,d])=>add(n,d));
  }
  if(script&&SBParser.extractBackgroundCastFromText){
    Object.entries(SBParser.extractBackgroundCastFromText(script)).forEach(([n,d])=>add(n,d));
  }
  return chars;
}

function trustedCharacterNames(text){
  const trusted=new Set();
  const script=scriptForCastExtraction()||((text&&!isClipReconstruction(text))?text:'')||clipsTextBlob();
  Object.keys(collectCastFromProject()).forEach(n=>trusted.add(String(n).toUpperCase().trim()));
  if(script&&SBParser.extractCharactersFromText){
    Object.keys(SBParser.extractCharactersFromText(script)).forEach(n=>{
      if(isValidCharacterName(n))trusted.add(String(n).toUpperCase().trim());
    });
  }
  if(script&&SBParser.extractBackgroundCastFromText){
    Object.keys(SBParser.extractBackgroundCastFromText(script)).forEach(n=>{
      if(isValidCharacterName(n))trusted.add(String(n).toUpperCase().trim());
    });
  }
  return trusted;
}

function syncCharactersFromParse(result,text,opts){
  opts=opts||{};
  let chars=Object.assign({},collectCastFromProject(),(result&&result.characters)||{});
  const script=scriptForCastExtraction()||text||clipsTextBlob();
  if(script&&SBParser.extractCharactersFromText){
    chars=SBParser.mergeCharMaps(chars,SBParser.extractCharactersFromText(script));
  }
  if(script&&SBParser.extractBackgroundCastFromText){
    chars=SBParser.mergeCharMaps(chars,SBParser.extractBackgroundCastFromText(script));
  }
  if(result&&result.scenes){
    result.scenes.forEach(sc=>{
      (sc.shots||[]).forEach(sh=>{
        (sh.characters_in_frame||[]).forEach(n=>{
          const up=String(n||'').replace(/\s*\([^)]*\)\s*/g,'').trim().toUpperCase();
          if(up&&chars[up]===undefined&&isValidCharacterName(up))chars[up]='';
        });
      });
    });
  }
  const normalized=SBCharacters.normalize(chars);
  const out={};
  Object.keys(normalized).forEach(k=>{
    const up=String(k).toUpperCase().trim();
    if(!up)return;
    const prev=state.characters[up]||{};
    const merged={...SBCharacters.DEFAULTS,...normalized[k],...prev};
    const dNew=normalized[k].description||'';
    const dPrev=prev.description||'';
    merged.description=dPrev.length>dNew.length?dPrev:dNew;
    out[up]=merged;
  });
  state.characters=pruneJunkCharacters(out,trustedCharacterNames(text));
  if(!opts.skipHydrate){
    SBCharacters.hydrate(state.characters,text||state.scriptText||clipTextBlob(),state.clips,(result&&result.characters)||{});
  }
  mergeDuplicateCharacters();
  applyCastRoles(state.characters,state.clips);
  const names=Object.keys(state.characters);
  if(names.length&&!state.selectedChar)state.selectedChar=names[0];
}

/* Fold duplicate cast cards ("MICHAEL RAMSEY" + "RAMSEY", junk-prefixed
   variants like "HIT HIM AGAIN CRUMB" + "CRUMB") into one character, keeping
   refs/kits and rewriting every clip's cast list. */
function mergeDuplicateCharacters(){
  if(!SBParser.findDuplicateCast)return 0;
  const aliases=SBParser.findDuplicateCast(state.characters);
  let n=0;
  Object.keys(aliases).forEach(dup=>{
    const keep=aliases[dup];
    const from=state.characters[dup],into=state.characters[keep];
    if(!from||!into)return;
    if(!into.description&&from.description)into.description=from.description;
    if(!into.wardrobe&&from.wardrobe)into.wardrobe=from.wardrobe;
    if(!(into.refUrl||'').startsWith('https://')&&(from.refUrl||'').startsWith('https://'))into.refUrl=from.refUrl;
    if(!into.kit&&from.kit)into.kit=from.kit;
    if(from.outfits&&from.outfits.length){into.outfits=(into.outfits||[]).concat(from.outfits)}
    delete state.characters[dup];
    state.clips.forEach(c=>{
      if(!Array.isArray(c.characters))return;
      const i=c.characters.indexOf(dup);
      if(i>=0){
        if(c.characters.indexOf(keep)<0)c.characters[i]=keep;
        else c.characters.splice(i,1);
      }
    });
    if(state.selectedChar===dup)state.selectedChar=keep;
    n++;
  });
  return n;
}

function pruneJunkCharacters(chars,trusted){
  const trustedSet=trusted||trustedCharacterNames(state.scriptText||'');
  const clipSet=new Set();
  const frameSet=new Set();
  state.clips.forEach(c=>{
    (c.characters||[]).forEach(n=>clipSet.add(String(n).toUpperCase().trim()));
    const blob=((c.description||'')+' '+(c.dialogue||'')).toUpperCase();
    Object.keys(chars||{}).forEach(n=>{
      const up=String(n).toUpperCase().trim();
      if(up&&blob.includes(up))frameSet.add(up);
    });
  });
  if(state.parseResult&&state.parseResult.scenes){
    state.parseResult.scenes.forEach(sc=>{
      (sc.shots||[]).forEach(sh=>{
        (sh.characters_in_frame||[]).forEach(n=>frameSet.add(String(n).toUpperCase().trim()));
      });
    });
  }
  const out={};
  Object.entries(chars||{}).forEach(([name,val])=>{
    const up=String(name).toUpperCase().trim();
    if(!up||up.length<2||up.length>40||!isValidCharacterName(up))return;
    if(trustedSet.has(up)){out[up]=val;return;}
    if(clipSet.has(up)||frameSet.has(up)){out[up]=val;return;}
    const words=up.split(/\s+/);
    if(words.length>4)return;
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
  return extractionText();
}

function repairCharactersFromClips(){
  if(!state.clips.length&&!state.scriptText)return false;
  let changed=false;
  state.clips.forEach(c=>{
    (c.characters||[]).forEach(n=>{
      const up=String(n||'').toUpperCase().trim();
      if(!up)return;
      if(isValidCharacterName(up)&&!state.characters[up]){
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
  const filtered=SBParser.filterCharacterMap?SBParser.filterCharacterMap(merged):merged;
  state.characters=SBCharacters.normalize(pruneJunkCharacters(filtered,trustedCharacterNames(norm)));
  SBCharacters.hydrate(state.characters,norm,state.clips,merged);
  if(!state.selectedChar)state.selectedChar=names[0];
  save();
  return true;
}
function registerCharFromParse(map,name,desc){
  const up=String(name||'').replace(/\s*\([^)]*\)\s*/g,'').trim().toUpperCase();
  if(!up||up.length<2||up.length>40||!isValidCharacterName(up))return;
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
  state.locationBible=[];
  if(state.clips.length)state.selectedId=state.clips[0].id;
  const syncR=await syncMasteryWithAgent(true);
  save();renderAll();
  const nChars=Object.keys(state.characters).length;
  const nLocs=(state.locationBible||[]).length;
  let msg=state.clips.length+' clips'+(nChars?' · '+nChars+' characters':'')+(nLocs?' · '+nLocs+' locations':'')+(syncR?' · synced':'');
  if(normInfo.wasFlattened)msg='Unflattened '+normInfo.before+'→'+normInfo.after+' lines · '+msg;
  const warn=SBParser.parseQualityWarning?SBParser.parseQualityWarning(result):'';
  if(warn)msg+=' — '+warn;
  toast(msg);
  openSidePanelsIfNeeded();
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

function grabVideoFrame(src,atSecondsFromEnd){
  return new Promise((resolve)=>{
    const v=document.createElement('video');
    v.muted=true;
    v.playsInline=true;
    v.preload='auto';
    // CORS mode for hosted clips AND local ComfyUI /view URLs (which send
    // ACAO when launched with --enable-cors-header) — else the canvas taints.
    if(src.startsWith('https://')||/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(src))v.crossOrigin='anonymous';
    let settled=false;
    const finish=(val)=>{if(settled)return;settled=true;resolve(val||null)};
    const grab=()=>{
      try{
        const w=v.videoWidth,h=v.videoHeight;
        if(!w||!h){finish(null);return}
        const c=document.createElement('canvas');
        c.width=w;c.height=h;
        c.getContext('2d').drawImage(v,0,0,w,h);
        finish(c.toDataURL('image/jpeg',0.9));
      }catch(_){finish(null)}
    };
    v.addEventListener('loadedmetadata',()=>{
      const t=Math.max(0,(v.duration||4)-(atSecondsFromEnd||0.12));
      v.currentTime=Number.isFinite(t)?t:0;
    });
    v.addEventListener('seeked',grab);
    v.addEventListener('error',()=>finish(null));
    setTimeout(()=>finish(null),12000);
    v.src=src;
  });
}

async function extractVideoEndFrame(videoUrl){
  const src=String(videoUrl||'');
  if(!src)return null;
  const direct=await grabVideoFrame(src,0.12);
  if(direct)return direct;
  // Provider CDNs without CORS headers taint the canvas — retry via the
  // same-origin streaming proxy so the grab succeeds.
  if(src.startsWith('https://')){
    return grabVideoFrame('/.netlify/functions/proxy-media?url='+encodeURIComponent(src),0.12);
  }
  return null;
}

async function resolvePrevClipFrameRef(state,clipIndex){
  if(clipIndex==null||clipIndex<1||!state.clips[clipIndex])return null;
  const prev=state.clips[clipIndex-1];
  if(!prev||!prev.videoUrl)return null;
  const frame=await extractVideoEndFrame(prev.videoUrl);
  if(!frame){
    toast('Continuity: could not read end frame of clip '+(prev.num||clipIndex)+' — chain weakened');
    return null;
  }
  // Host the frame so providers get a small https URL instead of a multi-MB data URI.
  try{
    if(window.SBStorage&&SBStorage.ready()&&curUser){
      return await SBStorage.uploadDataUrl(frame,'frames/'+(prev.id||('clip-'+(prev.num||clipIndex))));
    }
  }catch(_){/* fall through — server still accepts data:image/ URLs under 6MB */}
  return frame;
}

// Deterministic 31-bit seed (FNV-1a) so retries are reproducible and A/B-able.
function stableSeed(str){
  let h=0x811c9dc5;
  const s=String(str||'');
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}
  return (h>>>0)%2147483647;
}

async function runJob(clip){
  clip.status='generating';clip.error=null;renderAll();
  let prompt=buildPrompt(clip);
  const ref=SBCharacters.getRefForClip(state.characters,clip);
  try{
    const h=await hdrs();
    const vs=(typeof window.getVideoSettings==='function')?window.getVideoSettings('timeline'):null;
    let dur=vs?vs.duration:Math.min(15,Math.max(3,parseInt(state.global.clipDuration,10)||clip.durationSec||5));
    // Auto duration: fit each clip to its own dialogue/action instead of one
    // global length.
    if(vs&&vs.autoDuration&&typeof window.autoDurationForClip==='function'){
      dur=window.autoDurationForClip(clip,vs.model);
      clip.durationSec=dur;
    }
    const asp=vs?vs.aspect_ratio:(state.global.aspectRatio||'16:9');
    const pollModel=vs?vs.model:state.global.model;
    const pollProv=vs?vs.provider:((typeof window.inferVideoProvider==='function')?window.inferVideoProvider(pollModel):(pollModel&&pollModel.includes('grok')?'grok-imagine':pollModel&&pollModel.includes('sora')?'aivideoapi':'wavespeed'));
    const body={action:'submit',model:pollModel,prompt,duration:dur,aspect_ratio:asp,resolution:vs?vs.resolution:(state.global.quality||'720p'),provider:pollProv};
    // Deterministic seed: same clip + retry count → same request params (Wan/Seedance/Vidu honor it).
    body.seed=stableSeed(state.projectName+'|'+clip.id+'|'+(clip.retryCount||0));
    const modelCfg=(typeof window.getModelConfig==='function')?window.getModelConfig(pollModel,true):{};
    const maxRefs=Math.max(1,Math.min(7,modelCfg.maxRefImages||3));
    const promptBudget=(window.SBMastery&&SBMastery.promptBudgetForModel)?SBMastery.promptBudgetForModel(pollModel):900;
    if(ref&&ref.url&&String(ref.url).startsWith('https://'))body.character_image_url=ref.url;
    if(window.SBMastery){
      const mastery=window.SBMastery.resolveForTimeline(state,clip,{maxRefs});
      if(!body.character_image_url&&mastery.character_image_url)body.character_image_url=mastery.character_image_url;
      if(mastery.location_image_url)body.location_image_url=mastery.location_image_url;
      if(mastery.reference_images&&mastery.reference_images.length)body.reference_images=mastery.reference_images;
      body.prompt=window.SBMastery.enrichPrompt(body.prompt,mastery,{maxChars:promptBudget});
    }
    if(window.SBContinuity&&typeof SBContinuity.continuityForClip==='function'){
      const ci=state.clips.findIndex(c=>c.id===clip.id);
      const cont=SBContinuity.continuityForClip(state,ci);
      if(cont){
        body.prompt=SBContinuity.enrichPromptWithContinuity(body.prompt,state,clip,{maxChars:promptBudget});
        // Block boundary → lead with the canonical character ref; mid-block → lead
        // with the previous end frame. The server orders refs accordingly.
        body.ref_strategy=(clip._forceIdentity||cont.blockBreak)?'identity':'chain';
        delete clip._forceIdentity;
        if(cont.prevVideoUrl){
          const prevFrame=await resolvePrevClipFrameRef(state,ci);
          if(prevFrame)body.prev_frame_image_url=prevFrame;
        }
      }
    }
    // Local ComfyUI provider: the browser drives the GPU on this machine
    // directly — same enriched prompt/refs/seed, zero cloud cost.
    if(pollProv==='comfy-local'){
      if(!window.SBComfy)throw new Error('Local ComfyUI module not loaded — refresh the page');
      const host=String(state.global.comfyHost||'http://127.0.0.1:8188').replace(/\/+$/,'');
      if(!(await SBComfy.ping(host)))throw new Error('ComfyUI not reachable at '+host+". Start it on this machine with:  python main.py --enable-cors-header '*'");
      const refUrl=body.character_image_url||body.prev_frame_image_url||(body.reference_images&&body.reference_images[0])||null;
      $('queueBar').classList.add('on');
      try{
        const out=await SBComfy.generate(host,{
          prompt:body.prompt,refUrl,duration:dur,seed:body.seed,aspect:asp,
          workflowJson:state.global.comfyWorkflow||null,
          onProgress:m=>{$('queueText').textContent='Clip '+clip.num+': '+m}
        });
        clip.videoUrl=out.url;
        clip.provider='comfy-local';
        clip.continuity=null;
        clip.status='done';clip.error=null;save();renderAll();
        verifyClipAsync(clip);
        return;
      }finally{if(!state.queue.running)$('queueBar').classList.remove('on')}
    }
    const sub=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:h,body:JSON.stringify(body)});
    const sd=await sub.json();
    if(!sub.ok||!sd.request_id)throw new Error(formatGenError(sd,sub.status));
    clip.requestId=sd.request_id;
    clip.provider=sd.provider||pollProv;
    const jobProv=clip.provider;
    const t0=Date.now();
    while(Date.now()-t0<480000){
      await new Promise(r=>setTimeout(r,5000));
      const pollBody={action:'status',request_id:clip.requestId,model:pollModel,provider:jobProv};
      const pr=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:h,body:JSON.stringify(pollBody)});
      const pd=await pr.json();const st=(pd.status||pd.state||'').toUpperCase();
      if(st==='COMPLETED'||st==='SUCCESS'||st==='SUCCEEDED'||st==='DONE'){
        let videoUrl=pickVideoUrl(pd);
        if(!videoUrl){
          const rr=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:h,body:JSON.stringify({action:'result',request_id:clip.requestId,model:pollModel,provider:jobProv})});
          const rd=await rr.json();
          videoUrl=pickVideoUrl(rd);
        }
        if(!videoUrl)throw new Error('No video URL in provider response');
        clip.videoUrl=videoUrl;
        clip.continuity=null;
        clip.status='done';clip.error=null;save();renderAll();
        verifyClipAsync(clip);
        return;
      }
      if(st==='FAILED'||st==='ERROR')throw new Error(formatGenError(pd,pr.status));
    }
    throw new Error('Timed out');
  }catch(e){clip.status='draft';clip.error=e.message;save();renderAll();toast(e.message)}
}

// Fire-and-forget continuity scoring after a clip finishes (badge appears when done).
function verifyMode(){const el=$('gVerify');return el?el.value:'badge'}
function verifyClipAsync(clip){
  if(!window.SBVerify||verifyMode()==='off')return Promise.resolve(null);
  return SBVerify.scoreClip(state,clip).then(res=>{
    save();renderTimeline();
    if(state.selectedId===clip.id)renderDetail();
    return res;
  }).catch(()=>null);
}

/* ── AI upscaling (WaveSpeed-hosted FlashVSR / SeedVR2, open models) ── */
async function upscaleClip(clip,upscaler){
  if(!curUser)return toast('Sign in');
  if(!clip||!clip.videoUrl)return toast('Generate the clip first');
  if(clip.upscaled)return toast('Clip '+clip.num+' is already upscaled');
  const prevStatus=clip.status;
  clip.status='generating';renderAll();
  toast('Upscaling clip '+clip.num+' ('+(upscaler==='seedvr2'?'SeedVR2 4K':'FlashVSR')+')…');
  try{
    const h=await hdrs();
    const sub=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:h,body:JSON.stringify({action:'upscale',video_url:clip.videoUrl,upscaler:upscaler||'flashvsr'})});
    const sd=await sub.json();
    if(!sub.ok||!sd.request_id)throw new Error(formatGenError(sd,sub.status));
    const t0=Date.now();
    while(Date.now()-t0<480000){
      await new Promise(r=>setTimeout(r,5000));
      const pr=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:h,body:JSON.stringify({action:'status',request_id:sd.request_id,provider:'wavespeed'})});
      const pd=await pr.json();const st=(pd.status||pd.state||'').toUpperCase();
      if(st==='COMPLETED'||st==='SUCCESS'||st==='SUCCEEDED'||st==='DONE'){
        let url=pickVideoUrl(pd);
        if(!url){
          const rr=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:h,body:JSON.stringify({action:'result',request_id:sd.request_id,provider:'wavespeed'})});
          url=pickVideoUrl(await rr.json());
        }
        if(!url)throw new Error('Upscaler returned no video URL');
        clip.videoUrlSD=clip.videoUrlSD||clip.videoUrl;   // keep the original for undo
        clip.videoUrl=url;
        clip.upscaled=true;
        clip.status=prevStatus;save();renderAll();
        toast('Clip '+clip.num+' upscaled');
        return true;
      }
      if(st==='FAILED'||st==='ERROR')throw new Error(formatGenError(pd,pr.status));
    }
    throw new Error('Upscale timed out');
  }catch(e){clip.status=prevStatus;save();renderAll();toast('Upscale: '+e.message);return false}
}
async function upscaleApproved(){
  if(!curUser)return toast('Sign in');
  const targets=state.clips.filter(c=>c.status==='approved'&&c.videoUrl&&!c.upscaled);
  if(!targets.length)return toast('No approved, un-upscaled clips');
  if(state.queue.running)return;
  state.queue.running=true;$('queueBar').classList.add('on');
  let ok=0;
  for(let i=0;i<targets.length;i++){
    $('queueText').textContent='Upscaling '+(i+1)+' / '+targets.length;
    if(await upscaleClip(targets[i],'flashvsr'))ok++;
  }
  state.queue.running=false;$('queueBar').classList.remove('on');
  toast('Upscaled '+ok+' / '+targets.length+' clips — export when ready');
}

async function genSelected(){if(!curUser)return toast('Sign in');const c=state.clips.find(x=>x.id===state.selectedId);if(!c)return toast('Select clip');await runJob(c)}
async function batchGen(){
  if(!curUser)return toast('Sign in');if(state.queue.running)return;
  state.queue.running=true;$('queueBar').classList.add('on');
  const autoRetry=verifyMode()==='retry';
  for(let i=0;i<state.clips.length;i++){
    $('queueText').textContent='Clip '+(i+1)+' / '+state.clips.length;
    if(i>0&&!state.clips[i-1].videoUrl)toast('Clip '+i+' has no video — continuity refs may be weak for clip '+(i+1));
    const clip=state.clips[i];
    await runJob(clip);
    // Bounded auto-retry: ONE regeneration with identity-first refs and a new
    // seed when the verification pass flags the clip as off-canon.
    if(autoRetry&&clip.videoUrl&&window.SBVerify){
      $('queueText').textContent='Clip '+(i+1)+' / '+state.clips.length+' — verifying…';
      const res=await verifyClipAsync(clip);
      if(res&&res.available&&SBVerify.verdict(clip)==='bad'){
        toast('Clip '+(i+1)+' failed continuity check — retrying with identity refs');
        clip.retryCount=(clip.retryCount||0)+1;
        clip._forceIdentity=true;
        await runJob(clip);
      }
    }
  }
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
  state.global.clipDuration=$('gDuration').value==='auto'?'auto':(parseInt($('gDuration').value,10)||5);state.global.language=$('gLang').value;
  const gv=$('gVerify');if(gv)state.global.verifyMode=gv.value;
  save()}

function exportEDL(){
  const approved=state.clips.filter(c=>c.status==='approved'&&c.videoUrl);
  SBExport.exportEDL(approved.length?approved:state.clips);
  toast('EDL downloaded');
}
function exportProject(){SBExport.exportProject({clips:state.clips,characters:state.characters,locationBible:state.locationBible,global:state.global,assembly:state.assembly,projectName:state.projectName,scriptText:state.scriptText,parseResult:state.parseResult});toast('Project saved')}
function loadProject(){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json';
  inp.onchange=async()=>{const f=inp.files[0];if(!f)return;pushHistory();const d=JSON.parse(await f.text());
    state.clips=d.clips||[];state.characters=SBCharacters.normalize(d.characters||{});state.locationBible=d.locationBible||[];
    state.global=Object.assign(state.global,d.global||{});
    state.assembly=Object.assign(state.assembly,d.assembly||{});state.projectName=d.projectName||'Imported';
    state.scriptText=d.scriptText||'';state.parseResult=d.parseResult||null;
    const ta=$('scriptEditor');if(ta){ta.value=state.scriptText;ta._focused=false}
    state.clips.forEach(ensureClip);syncLocationBibleFromClips();save();renderAll();openScriptPanel();toast('Project loaded')};
  inp.click();
}

async function finalExport(){
  const clips=state.clips.filter(c=>c.status==='approved'&&c.videoUrl);
  if(!clips.length)return toast('Approve clips with video first');
  $('exportModal').classList.remove('hidden');$('exportStatus').textContent='Starting…';
  // Scene grouping for export color matching: clips in the same continuity
  // block grade to the block's first shot.
  const chk=$('chkMatchColor');
  const matchColor=chk?chk.checked:false;
  const groups=clips.map(c=>{
    const ci=state.clips.findIndex(x=>x.id===c.id);
    const blk=(window.SBContinuity&&SBContinuity.blockForClip)?SBContinuity.blockForClip(state,ci):null;
    return blk?blk.id:(c.sceneIdx!=null?'s'+c.sceneIdx:'all');
  });
  try{
    const blob=await SBExport.stitchClips(clips,{fade:state.assembly.masterFade||0.3,matchColor,groups},m=>$('exportStatus').textContent=m);
    SBExport.download('shotbreak-final.'+(blob.type.includes('zip')?'zip':'mp4'),blob,blob.type);
    $('exportStatus').textContent='Done!';
    toast('Final export downloaded');
  }catch(e){$('exportStatus').textContent=e.message;toast(e.message)}
}

function sendEditor(){openEditorPanel()}

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
  document.querySelectorAll('#stepper .step').forEach(el=>{
    el.onclick=()=>gotoStep(el.dataset.step);
  });
  const gateBtn=$('authGateBtn');
  if(gateBtn)gateBtn.onclick=()=>{$('loginOverlay').classList.remove('hidden');const em=$('loginEmail');if(em)em.focus()};
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
  const btnRecoverScriptBar=$('btnRecoverScriptBar');
  if(btnRecoverScriptBar)btnRecoverScriptBar.onclick=recoverCorruptScript;
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
  $('btnRegen').onclick=()=>{const c=state.clips.find(x=>x.id===state.selectedId);if(c)c.retryCount=(c.retryCount||0)+1;genSelected()};
  const btnUp=$('btnUpscale');if(btnUp)btnUp.onclick=()=>{const c=state.clips.find(x=>x.id===state.selectedId);if(!c)return toast('Select clip');upscaleClip(c,'flashvsr')};
  const btnUpAll=$('btnUpscaleAll');if(btnUpAll)btnUpAll.onclick=upscaleApproved;
  $('btnApprove').onclick=approveSelected;
  $('btnPreview').onclick=()=>{const c=state.clips.find(x=>x.id===state.selectedId);if(c&&c.videoUrl)window.open(c.videoUrl);else toast('No video')};
  $('btnPreviewAll').onclick=previewAll;
  $('btnExport').onclick=sendEditor;
  $('btnFinal').onclick=finalExport;
  $('btnEDL').onclick=exportEDL;
  $('btnSaveProj').onclick=exportProject;
  $('btnLoadProj').onclick=loadProject;
  const btnResync=$('btnResyncChars');
  if(btnResync)btnResync.onclick=async()=>{
    pushHistory();
    btnResync.disabled=true;
    try{
      const r=await syncMasteryWithAgent(true);
      renderCharacters();renderLocations();
      toast(masterySyncMessage(r));
    }catch(e){toast(e.message||'Character sync failed')}
    btnResync.disabled=false;
  };
  const btnResyncLocs=$('btnResyncLocs');
  if(btnResyncLocs)btnResyncLocs.onclick=async()=>{
    if(!state.clips.length&&!state.scriptText)return toast('Import or re-parse your script first');
    pushHistory();
    btnResyncLocs.disabled=true;
    try{
      const r=await syncMasteryWithAgent(true);
      renderLocations();renderCharacters();
      toast(masterySyncMessage(r));
      const panel=$('locationsPanel');if(panel)panel.open=true;
    }catch(e){toast(e.message||'Location sync failed')}
    btnResyncLocs.disabled=false;
  };
  $('btnAddChar').onclick=()=>{const n=prompt('Character name:');if(!n)return;pushHistory();state.characters[n.toUpperCase()]=Object.assign({},SBCharacters.DEFAULTS);state.selectedChar=n.toUpperCase();save();renderCharacters()};
  const btnAddProp=$('btnAddProp');if(btnAddProp)btnAddProp.onclick=addProp;
  /* Local ComfyUI settings */
  const comfyHostEl=$('gComfyHost');
  if(comfyHostEl){
    if(state.global.comfyHost)comfyHostEl.value=state.global.comfyHost;
    comfyHostEl.onchange=()=>{state.global.comfyHost=comfyHostEl.value.trim();save()};
  }
  const btnComfyTest=$('btnComfyTest');
  if(btnComfyTest)btnComfyTest.onclick=async()=>{
    const host=String((comfyHostEl&&comfyHostEl.value)||'http://127.0.0.1:8188').replace(/\/+$/,'');
    btnComfyTest.disabled=true;toast('Checking '+host+'…');
    const ok=window.SBComfy?await SBComfy.ping(host):false;
    btnComfyTest.disabled=false;
    toast(ok?'✓ ComfyUI connected at '+host:'✗ Not reachable — start ComfyUI on this machine with:  python main.py --enable-cors-header');
  };
  const btnComfyWf=$('btnComfyWf');
  if(btnComfyWf){
    if(state.global.comfyWorkflow)btnComfyWf.textContent='Workflow ✓';
    btnComfyWf.onclick=()=>{
      const inp=document.createElement('input');inp.type='file';inp.accept='.json,application/json';
      inp.onchange=async()=>{
        const f=inp.files[0];if(!f)return;
        try{
          const text=await f.text();
          const wf=JSON.parse(text);
          const hasEncode=Object.keys(wf).some(k=>wf[k]&&wf[k].class_type==='CLIPTextEncode');
          if(!hasEncode)throw new Error('That JSON has no CLIPTextEncode node — export from ComfyUI as "API Format" (enable Dev mode in ComfyUI settings)');
          state.global.comfyWorkflow=text;save();
          btnComfyWf.textContent='Workflow ✓';
          toast('Custom ComfyUI workflow saved — the Local ComfyUI model will use it');
        }catch(e){toast(e.message)}
      };
      inp.click();
    };
  }
  const btnEnrichCont=$('btnEnrichContinuity');if(btnEnrichCont)btnEnrichCont.onclick=async()=>{
    btnEnrichCont.disabled=true;
    try{await enrichContinuity()}finally{btnEnrichCont.disabled=false}
  };
  $('btnClosePreview').onclick=()=>$('previewModal').classList.add('hidden');
  $('btnCloseExport').onclick=()=>$('exportModal').classList.add('hidden');
  ['gFilm','gColor','gAspect','gQuality','gAudio','gModel','gDuration','gLang','gVerify'].forEach(id=>{const el=$(id);if(el)el.onchange=syncGlobal});
  const btnMore=$('btnSettingsMore'), panelFull=$('settingsFull');
  if(btnMore&&panelFull){
    btnMore.onclick=()=>{
      const open=panelFull.classList.toggle('hidden');
      btnMore.classList.toggle('open',!open);
      btnMore.setAttribute('aria-expanded',!open?'true':'false');
    };
  }
  initTimelineEditor();
  load();
  repairCorruptClips();
  if(state.scriptText&&isClipReconstruction(state.scriptText)){
    console.warn('[Shotbreak] scriptText looks like clip reconstruction — open ✎ Script and re-import your screenplay');
  }
  Object.keys(state.characters).forEach(n=>{
    if(!isValidCharacterName(n))delete state.characters[n];
  });
  mergeDuplicateCharacters();
  if(window.SBContinuity&&SBContinuity.cleanupInactiveCrowdCards)SBContinuity.cleanupInactiveCrowdCards(state);
  if(state.clips.length||state.scriptText||state.parseResult){
    bootstrapMastery(true,{skipHydrate:true});
    repairAllCharacterDescriptions();
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
    if($('gDuration')){
      // Migrate legacy default (5) to auto; otherwise restore the saved choice.
      const saved=state.global.clipDuration;
      const dv=(saved==null||saved===5||saved==='5')?'auto':String(saved);
      const ok=[...$('gDuration').options].some(o=>o.value===dv);
      if(ok)$('gDuration').value=dv;
    }
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
    if(!localStorage.getItem('SB_Timeline_script_hint_v3')){
      localStorage.setItem('SB_Timeline_script_hint_v3','1');
      setTimeout(()=>toast('Follow the steps: 1 Script → 2 Cast & Locations → 3 Generate → 4 Edit & Export'),1200);
    }
  }catch(e){}
}

document.addEventListener('DOMContentLoaded',()=>{initTestBadge();initAuth();bindUI()});
})();