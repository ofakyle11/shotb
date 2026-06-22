/* SHOTBREAK Timeline — Script Parser (offline module ①) */
window.SBParser = (function(){
  function isSH(t){return /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(t)}
  function isCC(t){return /^[A-Z][A-Z0-9 .'\-()]+$/i.test(t)&&t.length<40&&!isSH(t)&&!/^(FADE|CUT|DISSOLVE)/i.test(t)}
  function isPar(t){return /^\([^)]+\)$/.test(t)}
  function isTr(t){return /^(FADE IN|FADE OUT|CUT TO|DISSOLVE TO|SMASH CUT)/i.test(t)}
  function isSceneNumberOnly(t){return /^\d+[A-Z]?\.?$/.test(t)}
  function isTitlePageLine(t){
    if(isSH(t))return false;
    if(/^(written by|by |story by|draft|revision|page |registered|copyright|contact|address|phone|email|wga|version)/i.test(t))return true;
    if(/^[A-Z][A-Z\s]{3,40}$/.test(t)&&!isCC(t)&&t.split(/\s+/).length<=5)return true;
    return false;
  }
  function exCN(t){return t.replace(/\s*\([^)]*\)\s*/g,'').trim().toUpperCase()}
  function resCN(n,c){if(c[n]!==undefined)return n;for(const f of Object.keys(c)){if(f.split(/\s+/).length>1&&f.split(/\s+/).includes(n))return f}return n}
  function spS(t){
    const r=t.match(/[^.!?]+[.!?]+[\s]*/g)||[t],res=[];let b='';
    for(const s of r){b+=s;if(b.trim().split(/\s+/).length>=6||s===r[r.length-1]){res.push(b.trim());b=''}}
    if(b.trim())res.push(b.trim());return res;
  }
  function iT(t,d,c){
    const x=t.toLowerCase().replace(/\([^)]*\)/g,'');
    if(/\b(close[\s-]?up|eyes|mouth|hand|tears)\b/.test(x))return'CLOSE-UP';
    if(/\b(insert|phone|screen|key|gun|weapon|drive)\b/.test(x))return'INSERT';
    if(d&&c===2)return'TWO-SHOT';if(d)return'MEDIUM';
    if(/\b(behind|shoulder)\b/.test(x))return'OTS';
    if(/\b(wide|room|city|street|warehouse|sky|surround)\b/.test(x))return'WIDE';
    if(/\b(walks?|run|follow|track|through|across)\b/.test(x))return'TRACKING';
    if(/\b(looks?\s+at|stares?|meets?\s+(his|her)\s+eyes)\b/.test(x))return'CLOSE-UP';
    return'MEDIUM';
  }
  function iCm(t,s){
    const x=t.toLowerCase();
    if(/\b(slow(ly)?|creep)\b/.test(x))return'SLOW DOLLY';
    if(/\b(pan|scans?)\b/.test(x))return'PAN';
    if(/\b(follow|track)\b/.test(x)&&s==='TRACKING')return'STEADICAM';
    if(/\b(crash|sudden)\b/.test(x))return'HANDHELD';
    return'STATIC';
  }
  function inferLocation(heading){
    if(!heading)return'';
    const m=heading.match(/^(?:INT\.|EXT\.|INT\/EXT\.)\s+([^-]+)/i);
    return m?m[1].trim():'';
  }
  function inferTOD(heading){
    if(!heading)return'Day';
    if(/\bNIGHT\b/i.test(heading))return'Night';
    if(/\bDAWN\b/i.test(heading))return'Dawn';
    if(/\bDUSK\b/i.test(heading))return'Dusk';
    return'Day';
  }

  const CAP_FALSE_POS=new Set([
    'INT','EXT','I/E','INT/EXT','FADE','CUT','DISSOLVE','ANGLE','POV','CLOSE','WIDE','INSERT',
    'DAY','NIGHT','MORNING','EVENING','CONTINUOUS','LATER','MOMENTS','CONT','VO','OS','OC',
    'THE','AND','BUT','WITH','FROM','INTO','OVER','UNDER','AFTER','BEFORE','SCENE','SHOT',
    'FADE IN','FADE OUT','CUT TO','SMASH CUT','DISSOLVE TO','SUPER','TITLE','END','MONTAGE'
  ]);

  function cleanCharName(raw){
    if(!raw)return'';
    return raw.replace(/\s*\([^)]*\)\s*/g,'').replace(/\s*[-–—:]\s*$/,'').replace(/\s+/g,' ').trim().toUpperCase();
  }

  function registerChar(chars,name,desc){
    const cn=cleanCharName(name);
    if(!cn||cn.length<2||cn.length>40)return;
    if([...cn.split(/\s+/)].every(w=>CAP_FALSE_POS.has(w)))return;
    if(chars[cn]===undefined)chars[cn]=desc||'';
    else if(desc&&!chars[cn])chars[cn]=desc;
  }

  function isCharCueLine(t){
    if(!t)return false;
    if(isSH(t))return false;
    if(/^(FADE|CUT|DISSOLVE|SMASH|MATCH|IRIS|WIPE|THE END)/i.test(t))return false;
    if(/^\(.+\)$/.test(t))return false;
    const cuePart=t.replace(/\s*\([^)]*\)\s*$/,'').trim();
    if(!cuePart||cuePart.length<2||cuePart.length>40)return false;
    if(cuePart!==cuePart.toUpperCase())return false;
    if(/[.!?,;:]$/.test(cuePart))return false;
    if(!/[A-Z]/.test(cuePart))return false;
    const words=cuePart.split(/\s+/);
    if(words.every(w=>CAP_FALSE_POS.has(w)))return false;
    return true;
  }

  /** Normalize PDF / pasted blobs — restore line breaks screenplay parsers expect. */
  function normalizeScriptText(text){
    if(!text)return'';
    let t=String(text).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    if(t.split('\n').length<8&&t.length>400){
      t=t
        .replace(/\s+(?=(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s)/gi,'\n\n')
        .replace(/\s+(?=(?:FADE IN|FADE OUT|CUT TO|DISSOLVE TO)\b)/gi,'\n\n');
    }
    return t;
  }

  /** Pull character names from screenplay cues, dialogue labels, and ALL-CAPS mentions. */
  function extractCharactersFromText(text){
    const chars={};
    const norm=normalizeScriptText(text);
    if(!norm.trim())return chars;
    const lines=norm.split('\n');
    let inDialogue=false;
    lines.forEach(line=>{
      const t=line.trim();
      if(!t){inDialogue=false;return;}
      const fountain=t.match(/^@([A-Za-z][A-Za-z0-9 .'\-]{1,35})$/);
      if(fountain){registerChar(chars,fountain[1],'');inDialogue=true;return;}
      const inlineDlg=t.match(/^([A-Z][A-Z0-9 .'\-()]{1,35})\s*(?:\([^)]*\))?\s*:\s+/);
      if(inlineDlg){registerChar(chars,inlineDlg[1],'');inDialogue=true;return;}
      const dlgLabel=t.match(/^([A-Z][A-Z0-9 .'\-()]{1,35})\s*(?:\([^)]*\))?\s*:\s*$/);
      if(dlgLabel){registerChar(chars,dlgLabel[1],'');inDialogue=true;return;}
      if(isCharCueLine(t)||isCC(t)){
        const ci=t.match(/\(([^)]+)\)/);
        const desc=ci&&ci[1]&&!/^(V\.?O\.?|O\.?S\.?|CONT'?D?|O\.?C\.?)$/i.test(ci[1].trim())?ci[1].trim():'';
        registerChar(chars,t,desc);
        inDialogue=true;
        return;
      }
      if(isSH(t)){inDialogue=false;return;}
      if(!inDialogue){
        const parenIntro=t.match(/\b([A-Z][A-Z0-9 .'\-]{1,30})\s*\([^)]{3,}\)/);
        if(parenIntro)registerChar(chars,parenIntro[1],'');
      }
    });
    const caps=norm.match(/\b[A-Z][A-Z0-9\-']{2,18}(?:\s+[A-Z][A-Z0-9\-']{2,18}){0,2}\b/g)||[];
    caps.forEach(m=>registerChar(chars,m.trim(),''));
    const titled=norm.match(/\b(?:Mr|Mrs|Ms|Dr|Det|Agent|Sgt|Officer|Captain)\.?\s+[A-Z][A-Za-z\-']{2,20}\b/g)||[];
    titled.forEach(m=>registerChar(chars,m.replace(/\./g,'').trim(),''));
    const proper=norm.match(/\b([A-Z][a-z]{2,18}(?:\s+[A-Z][a-z]{2,18})?)\b/g)||[];
    const SKIP_PROP=new Set(['fade','cut','dissolve','int','ext','scene','close','wide','the','and','but','with','from','into','over','under','rain','water','tin','roof']);
    proper.forEach(m=>{
      const parts=m.split(/\s+/);
      if(parts.every(p=>SKIP_PROP.has(p.toLowerCase())))return;
      if(parts[0].length<2)return;
      registerChar(chars,m,'');
    });
    return chars;
  }

  function mergeCharMaps(base,extra){
    const out=Object.assign({},base||{});
    Object.entries(extra||{}).forEach(([n,d])=>registerChar(out,n,d));
    return out;
  }

  function attachCharactersToShots(scenes,chars){
    if(!scenes||!chars)return;
    const names=Object.keys(chars);
    scenes.forEach(sc=>{
      (sc.shots||[]).forEach(sh=>{
        const found=new Set(sh.characters_in_frame||[]);
        const blob=((sh.description||'')+' '+(sh.dialogue||'')).toUpperCase();
        names.forEach(n=>{
          if(blob.includes(n))found.add(n);
        });
        sh.characters_in_frame=[...found];
      });
    });
  }

  function parse(text, durSec){
    const dur=durSec||5;
    const dl=dur+'-'+(dur+1)+'s';
    const lines=normalizeScriptText(text).split('\n'),scenes=[],chars={};
    let cur=null,i=0,seenFirstScene=false;
    while(i<lines.length){
      const l=lines[i],t=l.trim();
      if(!t||isTr(t)){i++;continue}
      if(isSceneNumberOnly(t)&&i+1<lines.length&&isSH(lines[i+1].trim())){i++;continue}
      if(isSH(t)){cur={heading:t,shots:[]};scenes.push(cur);seenFirstScene=true;i++;continue}
      if(!seenFirstScene&&isTitlePageLine(t)){i++;continue}
      if(!cur){
        if(!seenFirstScene&&isTitlePageLine(t)){i++;continue}
        cur={heading:'SCENE 1',shots:[]};scenes.push(cur);seenFirstScene=true;
      }
      if(isCC(t)){
        const rn=exCN(t),cn=resCN(rn,chars),ci=t.match(/\(([^)]+)\)/);
        if(chars[cn]===undefined)chars[cn]=ci?ci[1]:'';
        i++;let par='',dl2=[];
        while(i<lines.length){
          const d=lines[i];
          if(!d.trim()||isSH(d.trim()))break;
          if(isCC(d.trim())&&!isPar(d))break;
          if(isPar(d))par=d.trim();else dl2.push(d.trim());
          i++;
        }
        if(dl2.length){
          const fd=dl2.join(' '),tp=iT(fd,!0,1),cm=iCm(fd,tp);
          let ds='Close on '+cn;if(chars[cn])ds+=' ('+chars[cn]+')';
          if(par)ds+=', '+par.replace(/[()]/g,'');
          ds+=', delivering dialogue.';
          cur.shots.push({type:tp,camera:cm,duration:dl,description:ds,dialogue:fd,characters_in_frame:[cn],cine:{}});
        }
        continue;
      }
      const ss=spS(t);
      for(const s of ss){
        let m=[];
        Object.keys(chars).forEach(c=>{if(s.toUpperCase().includes(c)&&!m.includes(c))m.push(c)});
        cur.shots.push({type:iT(s,!1,m.length),camera:iCm(s,iT(s,!1,m.length)),duration:dl,description:s,dialogue:null,characters_in_frame:m,cine:{}});
      }
      i++;
    }
    const enriched=mergeCharMaps(chars,extractCharactersFromText(text));
    attachCharactersToShots(scenes,enriched);
    return{scenes,characters:enriched};
  }

  function scenesToClips(result, global, clipDur){
    const clips=[];
    const labels=['Opening scene','Character intro','Dialogue','Action beat','Reaction shot','Scene transition','Climax','Resolution','Epilogue'];
    let n=0;
    result.scenes.forEach((sc,si)=>{
      sc.shots.forEach((sh,shi)=>{
        n++;
        const loc=inferLocation(sc.heading);
        const tod=inferTOD(sc.heading);
        clips.push({
          id:'clip-'+String(n).padStart(2,'0'),
          num:n,
          label:labels[(n-1)%labels.length]||('Beat '+n),
          sceneIdx:si,shotIdx:shi,
          heading:sc.heading,
          durationSec:clipDur||5,
          status:'draft',
          description:sh.description||'',
          dialogue:sh.dialogue||'',
          shotType:sh.type||'MEDIUM',
          camera:sh.camera||'STATIC',
          characters:sh.characters_in_frame||[],
          emotion:'Neutral',
          videoUrl:null,
          requestId:null,
          error:null,
          edit:{trimIn:0,trimOut:null,transition:'cut',transitionDur:0.5,speed:1,overlayFx:'',colorCorrect:''},
          params:{
            scene:{on:{location:true,timeOfDay:true,weather:false,season:false},location:loc,timeOfDay:tod,weather:'Clear',season:'Summer'},
            camera:{on:{angle:true,filmGrade:true,colorMode:true,saturation:false},angle:sh.type||'Medium',filmGrade:global.filmStyle||'35mm Grain',colorMode:'Color',saturation:'0'},
            atmosphere:{on:{lighting:true,mood:true,fx:false,sound:false},lighting:'Natural',mood:'Cinematic',fx:'',sound:''}
          }
        });
      });
    });
    return clips;
  }

  async function readFile(file){
    const name=(file.name||'').toLowerCase();
    if(name.endsWith('.txt'))return file.text();
    if(name.endsWith('.fdx'))return readFdx(file);
    if(name.endsWith('.pdf'))return readPdf(file);
    throw new Error('Unsupported file — use .txt, .fdx, or .pdf');
  }

  async function readFdx(file){
    const t=await file.text();
    const d=new DOMParser().parseFromString(t,'application/xml');
    const ps=d.getElementsByTagName('Paragraph'),ls=[];
    for(let i=0;i<ps.length;i++){
      const tp=ps[i].getAttribute('Type')||'';
      const ts=ps[i].getElementsByTagName('Text');
      let c='';for(let j=0;j<ts.length;j++)c+=ts[j].textContent;
      if(['Scene Heading','Action','Character','Dialogue','Parenthetical','Transition'].includes(tp)){
        ls.push(c);
        if(tp==='Scene Heading'||tp==='Transition')ls.push('');
      }
    }
    return ls.join('\n');
  }

  async function readPdf(file){
    if(!window.pdfjsLib)throw new Error('PDF library not loaded');
    const buf=await file.arrayBuffer();
    const pdf=await window.pdfjsLib.getDocument({data:buf}).promise;
    let text='';
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const content=await page.getTextContent();
      text+=content.items.map(it=>it.str).join(' ')+'\n';
    }
    return text;
  }

  return{parse,scenesToClips,readFile,extractCharactersFromText,mergeCharMaps,normalizeScriptText};
})();