/* SHOTBREAK Timeline — Script Parser (offline module ①) */
window.SBParser = (function(){
  function isSH(t){
    const line=(t||'').trim();
    if(!line)return false;
    if(/^(?:(?:SC|SCENE)\s*\d+[A-Z]?[.\s\-]+\s*|\d+[.\s-]+\s*)?(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)[\s\-]/i.test(line))return true;
    if(/^SCENE\s+\d+(?:\s*[.\-—:]\s*|\s+)/i.test(line))return true;
    if(/^(FLASHBACK|FLASH\s*CUT|MONTAGE|DREAM|INTERCUT|BACK\s+TO|LATER|TIME\s+CUT|SERIES\s+OF\s+SHOTS)\b/i.test(line)&&line===line.toUpperCase())return true;
    if(/^\d+[.\s]+\s*[A-Z][A-Z0-9\s'\-]+\s+[-—–]\s+(DAY|NIGHT|MORNING|EVENING|DUSK|DAWN|CONTINUOUS|LATER)\s*$/i.test(line))return true;
    return /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(line);
  }
  /** Character cue — must be ALL CAPS (matches Edit Studio isCC). */
  function isCC(l){
    const t=(l||'').trim();
    if(!t||t.length<2||t.length>40||isSH(t))return false;
    if(/^(FADE|CUT|DISSOLVE|SMASH|MATCH|IRIS|WIPE)/.test(t))return false;
    const n=t.replace(/\s*\(.*\)\s*$/,'');
    return n===n.toUpperCase()&&!/[.!?,;:]$/.test(n)&&!((/^\(/.test(t)&&/\)$/.test(t)));
  }
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
    'FADE IN','FADE OUT','CUT TO','SMASH CUT','DISSOLVE TO','SUPER','TITLE','END','MONTAGE',
    'ABANDONED','WAREHOUSE','BUILDING','APARTMENT','HOUSE','OFFICE','FACTORY','ALLEY','STREET',
    'ROOM','HALLWAY','CORRIDOR','BASEMENT','ATTIC','GARAGE','KITCHEN','BEDROOM','ROOF','CEILING',
    'PARKING','FIELD','FOREST','BEACH','DESERT','HIGHWAY','ROAD','BRIDGE','TUNNEL','HOSPITAL',
    'SCHOOL','CHURCH','STATION','AIRPORT','PRISON','COURTROOM','LOBBY','BAR','RESTAURANT','LAB'
  ]);

  function isLocationCaps(name){
    const LOC=new Set(['ABANDONED','WAREHOUSE','BUILDING','APARTMENT','HOUSE','OFFICE','FACTORY','ALLEY','STREET','ROOM','HALLWAY','CORRIDOR','BASEMENT','ATTIC','GARAGE','KITCHEN','BEDROOM','ROOF','CEILING','PARKING','FIELD','FOREST','BEACH','DESERT','HIGHWAY','ROAD','BRIDGE','TUNNEL','HOSPITAL','SCHOOL','CHURCH','STATION','AIRPORT','PRISON','COURTROOM','LOBBY','BAR','RESTAURANT','LAB','LOCATION','INTERIOR','EXTERIOR']);
    const words=String(name||'').toUpperCase().split(/\s+/);
    if(!words.length)return true;
    return words.every(w=>LOC.has(w)||CAP_FALSE_POS.has(w));
  }

  function cleanCharName(raw){
    if(!raw)return'';
    return raw.replace(/\s*\([^)]*\)\s*/g,'').replace(/\s*[-–—:]\s*$/,'').replace(/\s+/g,' ').trim().toUpperCase();
  }

  function registerChar(chars,name,desc){
    const cn=cleanCharName(name);
    if(!cn||cn.length<2||cn.length>40)return;
    if([...cn.split(/\s+/)].every(w=>CAP_FALSE_POS.has(w)))return;
    if(isLocationCaps(cn))return;
    if(/^(INT|EXT|I\/E|INT\/EXT)\b/.test(cn))return;
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

  function looksLikeCharCue(name){
    const cn=cleanCharName(name);
    if(!cn||cn.length<2||cn.length>40)return false;
    if(isLocationCaps(cn))return false;
    if(/^(INT|EXT|I\/E|INT\/EXT)\b/.test(cn))return false;
    const words=cn.split(/\s+/);
    if(words.every(w=>CAP_FALSE_POS.has(w)))return false;
    return true;
  }

  /** Split flattened PDF blobs before character cues and action-line names. */
  function insertCueBreaks(t){
    return t
      .replace(/([.!?])\s+([A-Z][A-Z0-9 .'\-]{1,30})(\s*\([^)]{0,80}\))?\s+(?=[(\[]|[a-z])/g,(m,p1,p2,p3)=>{
        if(!looksLikeCharCue(p2))return m;
        return p1+'\n\n'+p2+(p3||'')+'\n';
      })
      .replace(/\)\s+([A-Z][A-Z0-9 .'\-]{1,30})(\s*\([^)]{0,60}\))?\s*(?=\(|$|[a-z])/g,(m,p1,p2)=>{
        if(!looksLikeCharCue(p1))return m;
        return ')\n\n'+p1+(p2||'')+'\n';
      })
      .replace(/\s{2,}([A-Z][A-Z0-9 .'\-]{1,28})(\s*\([^)]{0,60}\))?\s+(?=\()/g,(m,p1,p2)=>{
        if(!looksLikeCharCue(p1))return m;
        return '\n\n'+p1+(p2||'')+'\n';
      })
      .replace(/\s+([A-Z][A-Z0-9 .'\-]{1,28})(\s*\([^)]{0,60}\))?\s+(?=[A-Za-z][a-z])/g,(m,p1,p2)=>{
        if(!looksLikeCharCue(p1))return m;
        return '\n\n'+p1+(p2||'')+'\n';
      })
      .replace(/\s+([A-Z]{2,}(?:\s+[A-Z]{2,}){0,2})\s+(?=[a-z])/g,(m,p1)=>{
        if(!looksLikeCharCue(p1)||isSH(p1))return m;
        return '\n\n'+p1+'\n';
      });
  }

  /** Normalize PDF / pasted blobs — restore line breaks screenplay parsers expect. */
  function normalizeScriptText(text){
    if(!text)return'';
    let t=String(text).replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\t/g,' ');
    const lineCount=t.split('\n').filter(l=>l.trim()).length;
    const needsReflow=lineCount<20&&t.length>250;
    if(needsReflow){
      t=t
        .replace(/\s+(?=(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s)/gi,'\n\n')
        .replace(/\s+(?=(?:FADE IN|FADE OUT|CUT TO|DISSOLVE TO|SMASH CUT)\b)/gi,'\n\n');
      t=insertCueBreaks(t);
    }
    return t.replace(/\n{3,}/g,'\n\n').trim();
  }

  function parseQualityWarning(result){
    if(!result||!result.scenes||!result.scenes.length)return'';
    const heads=result.scenes.map(s=>(s.heading||'').trim().toUpperCase());
    const allFallback=heads.every(h=>h==='SCENE 1'||!h);
    if(allFallback&&result.scenes.length>=4)return'Parser could not find scene headings (INT./EXT.). Try .txt/.fdx or fix line breaks.';
    if(result.scenes.length>=8&&heads.filter(h=>h==='SCENE 1').length>=6)return'Many shots landed in fallback SCENE 1 — screenplay structure may be flattened (common with PDF).';
    return'';
  }

  function extractActionLineName(t){
    if(!t||isSH(t)||isTr(t))return null;
    const m=t.match(/^([A-Z][A-Z0-9 .'\-]{1,30}(?:\s+[A-Z][A-Z0-9 .'\-]{1,30})?)\s+(?=[a-z])/);
    return m&&looksLikeCharCue(m[1])?m[1]:null;
  }

  function extractInlineCue(t){
    if(!t||isSH(t))return null;
    const m=t.match(/^([A-Z][A-Z0-9 .'\-]{1,30})(\s*\([^)]{0,80}\))?\s+(?=[(\[]|[a-z]["'])/);
    if(!m||!looksLikeCharCue(m[1]))return null;
    if(isCharCueLine(m[1]+(m[2]||'')))return{name:m[1],desc:''};
    const ci=(m[2]||'').match(/\(([^)]+)\)/);
    const desc=ci&&ci[1]&&!/^(V\.?O\.?|O\.?S\.?|CONT'?D?|O\.?C\.?)$/i.test(ci[1].trim())?ci[1].trim():'';
    return{name:m[1],desc};
  }

  /** Pull character names from screenplay cues, dialogue labels, and action intros. */
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
      if(isCharCueLine(t)){
        const ci=t.match(/\(([^)]+)\)/);
        const desc=ci&&ci[1]&&!/^(V\.?O\.?|O\.?S\.?|CONT'?D?|O\.?C\.?)$/i.test(ci[1].trim())?ci[1].trim():'';
        registerChar(chars,t,desc);
        inDialogue=true;
        return;
      }
      if(isSH(t)){inDialogue=false;return;}
      if(!inDialogue){
        const inlineCue=extractInlineCue(t);
        if(inlineCue){registerChar(chars,inlineCue.name,inlineCue.desc);inDialogue=true;return;}
        const actionName=extractActionLineName(t);
        if(actionName)registerChar(chars,actionName,'');
        const parenIntro=t.match(/\b([A-Z][A-Z0-9 .'\-]{1,30}(?:\s+[A-Z][A-Z0-9 .'\-]{1,30})?)\s*\([^)]{3,}\)/);
        if(parenIntro)registerChar(chars,parenIntro[1],'');
      }
    });
    const titled=norm.match(/\b(?:Mr|Mrs|Ms|Dr|Det|Agent|Sgt|Officer|Captain)\.?\s+[A-Z][A-Za-z\-']{2,20}\b/g)||[];
    titled.forEach(m=>registerChar(chars,m.replace(/\./g,'').trim(),''));
    return chars;
  }

  /** Detect timeline clip metadata pasted back as a "script" (not a real screenplay). */
  function isClipReconstruction(text){
    if(!text||!String(text).trim())return false;
    const t=String(text);
    const dlgHits=(t.match(/delivering dialogue\./gi)||[]).length;
    const closeHits=(t.match(/Close on\s+[A-Z]/gi)||[]).length;
    const scene1=(t.match(/^SCENE 1\s*$/gim)||[]).length;
    if(dlgHits>=2||(closeHits>=2&&dlgHits>=1))return true;
    if(scene1>=5&&dlgHits>=1)return true;
    return false;
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
        const actionName=extractActionLineName(s);
        if(actionName){
          const r=resCN(cleanCharName(actionName),chars);
          if(chars[r]===undefined)chars[r]='';
          if(!m.includes(r))m.push(r);
        }
        const im=s.match(/([A-Z][A-Z0-9 .'\-]{1,30}(?:\s+[A-Z][A-Z0-9 .'\-]{1,30})?)\s*\(([^)]+)\)/);
        if(im){
          const rn=im[1].trim(),r=resCN(rn,chars);
          if(chars[r]===undefined)chars[rn]=im[2].trim();
          if(!m.includes(r))m.push(r);
        }
        s.split(/\s+/).forEach(w=>{
          const u=w.replace(/[^A-Z]/g,'');
          if(u.length>=2){const r=resCN(u,chars);if(chars[r]!==undefined&&!m.includes(r))m.push(r)}
        });
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

  function pdfItemsToLines(items){
    const bits=items.map(it=>({
      str:String(it.str||'').replace(/\s+/g,' ').trim(),
      x:it.transform?it.transform[4]:0,
      y:it.transform?it.transform[5]:0
    })).filter(it=>it.str);
    bits.sort((a,b)=>b.y-a.y||a.x-b.x);
    const Y_TOL=5,lines=[];
    let curY=null,bucket=[];
    bits.forEach(it=>{
      if(curY===null||Math.abs(it.y-curY)>Y_TOL){
        if(bucket.length){
          bucket.sort((a,b)=>a.x-b.x);
          lines.push(bucket.map(b=>b.str).join(' ').trim());
        }
        bucket=[it];curY=it.y;
      }else bucket.push(it);
    });
    if(bucket.length){
      bucket.sort((a,b)=>a.x-b.x);
      lines.push(bucket.map(b=>b.str).join(' ').trim());
    }
    return lines;
  }

  async function readPdf(file){
    if(!window.pdfjsLib)throw new Error('PDF library not loaded');
    const buf=await file.arrayBuffer();
    const pdf=await window.pdfjsLib.getDocument({data:buf}).promise;
    const pages=[];
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const content=await page.getTextContent();
      pages.push(pdfItemsToLines(content.items).join('\n'));
    }
    return pages.join('\n\n');
  }

  return{parse,scenesToClips,readFile,extractCharactersFromText,mergeCharMaps,normalizeScriptText,isClipReconstruction,parseQualityWarning};
})();