/* Module ⑤ — Character consistency */
window.SBCharacters = (function () {
  const DEFAULTS = {
    description: '', refUrl: null, faceLock: false, bodyType: 'Average',
    wardrobe: '', voice: 'Natural', lipSync: true, emotion: 'Neutral', lockMethod: 'ip-adapter',
    role: 'lead'
  };

  function normalize (raw) {
    const out = {};
    Object.entries(raw || {}).forEach(([name, val]) => {
      if (typeof val === 'string') out[name] = { ...DEFAULTS, description: val };
      else out[name] = { ...DEFAULTS, ...val };
    });
    return out;
  }

  function normalizeScript (text) {
    if (window.SBParser && window.SBParser.normalizeScriptText) {
      return window.SBParser.normalizeScriptText(text);
    }
    return String(text || '').replace(/\r\n/g, '\n');
  }

  /** Pull appearance from action lines: NAME (traits), NAME, traits, intro sentence. */
  function synthesizeDescription (name, scriptText, hint) {
    const script = normalizeScript(scriptText);
    if (!script.trim()) return (hint || '').trim();
    const upName = String(name || '').toUpperCase();
    const escName = upName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRE = new RegExp('\\b' + escName + '\\b', 'i');

    const bruteParen = script.match(new RegExp(escName + '\\s*\\(([^)]{3,200})\\)', 'i'));
    if (bruteParen && bruteParen[1] && !/^(v\.?o\.?|o\.?s\.?|cont'?d)$/i.test(bruteParen[1].trim())) {
      const bit = bruteParen[1].trim();
      if (hint && hint.trim()) return (hint.trim() + '. ' + bit).slice(0, 420);
      return bit.slice(0, 420);
    }
    const bruteComma = script.match(new RegExp(escName + '\\s*,\\s*([^.!?\\n]{4,200})', 'i'));
    if (bruteComma && bruteComma[1]) {
      const bit = bruteComma[1].trim();
      if (hint && hint.trim()) return (hint.trim() + '. ' + bit).slice(0, 420);
      return bit.slice(0, 420);
    }

    const lines = script.split('\n');

    const ACTION = 1; const DIALOGUE = 2; const CUE = 3; const SLUG = 4; const PAREN = 5; const BLANK = 6;
    const cls = new Array(lines.length);
    let inDialogue = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) { cls[i] = BLANK; inDialogue = false; continue; }
      if (window.SBParser && typeof window.SBParser.parseSceneHeading === 'function') {
        const sh = window.SBParser.parseSceneHeading(t);
        if (sh && sh.key) { cls[i] = SLUG; inDialogue = false; continue; }
      } else if (/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(t)) { cls[i] = SLUG; inDialogue = false; continue; }
      if (/^\(.+\)$/.test(t)) { cls[i] = PAREN; continue; }
      const cuePart = t.replace(/\s*\([^)]*\)\s*$/, '').trim();
      const isCue = cuePart.length > 0 && cuePart.length < 40
        && cuePart === cuePart.toUpperCase()
        && /[A-Z]/.test(cuePart)
        && !/[.!?,;:]$/.test(cuePart)
        && !/^(FADE|CUT|DISSOLVE|SMASH|MATCH|IRIS|WIPE|THE END)/i.test(cuePart);
      if (isCue) { cls[i] = CUE; inDialogue = true; continue; }
      if (inDialogue) { cls[i] = DIALOGUE; continue; }
      cls[i] = ACTION;
    }

    let parenTraits = '';
    let commaTraits = '';
    let introSentence = '';
    const laterActions = [];
    let firstMentionIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      if (cls[i] !== ACTION) continue;
      const L = lines[i];
      if (!nameRE.test(L)) continue;
      if (firstMentionIdx === -1) firstMentionIdx = i;

      if (!parenTraits) {
        const p = L.match(new RegExp(escName + '\\s*\\(([^)]{3,200})\\)', 'i'));
        if (p) parenTraits = p[1].trim();
      }
      if (!commaTraits) {
        const c = L.match(new RegExp(escName + '\\s*,\\s*([^.!?]{3,200}?)(?=[.!?]|\\s+(?:steps|walks|moves|stands|sits|enters|looks|turns|opens|closes|raises|lowers|draws|fires|whispers|shouts|says|tells|runs|falls|appears|emerges|exits))', 'i'));
        if (c) commaTraits = c[1].trim();
      }
      if (!introSentence && i === firstMentionIdx) {
        const t = L.trim();
        const sents = t.split(/(?<=[.!?])\s+/);
        for (const s of sents) {
          if (nameRE.test(s)) { introSentence = s.trim(); break; }
        }
        if (!introSentence) introSentence = t.substring(0, 220);
      } else if (laterActions.length < 2) {
        const t = L.trim();
        if (t.length < 280) laterActions.push(t);
      }
    }

    const parts = [];
    if (hint && hint.trim()) parts.push(hint.trim());
    if (parenTraits) parts.push(parenTraits);
    else if (commaTraits) parts.push(commaTraits);
    else if (introSentence) {
      parts.push(introSentence.replace(nameRE, '').replace(/^\s*[,.\-–—:\s]+/, '').trim());
    }
    if (parts.join(' ').length < 24 && laterActions.length) {
      parts.push(laterActions[0].replace(nameRE, '').replace(/^\s*[,.\-–—:\s]+/, '').trim().substring(0, 160));
    }

    if (!parts.length) return (hint || '').trim();
    return parts.filter(Boolean).join('. ').replace(/\s+/g, ' ').replace(/\.\s*\./g, '.').trim().slice(0, 420);
  }

  function inferWardrobe (desc) {
    const d = String(desc || '');
    const patterns = [
      /\b(?:tailored\s+)?(?:black\s+|white\s+|dark\s+|grey\s+|gray\s+|navy\s+)?suit\b[^.,;]*/i,
      /\b(?:leather|trench|bomber|denim|military|army)\s+jacket\b[^.,;]*/i,
      /\b(?:worn\s+)?(?:overcoat|coat|uniform|robes?|gown|dress|tuxedo|scrubs|lab\s+coat)\b[^.,;]*/i,
      /\b(?:hoodie|sweater|shirt|blouse|vest|armor|fatigues)\b[^.,;]*/i
    ];
    for (let i = 0; i < patterns.length; i++) {
      const m = d.match(patterns[i]);
      if (m) return m[0].trim().slice(0, 120);
    }
    return '';
  }

  function inferBodyType (desc) {
    const d = String(desc || '').toLowerCase();
    if (/\b(stocky|burly|heavyset|broad|thick)\b/.test(d)) return 'Stocky';
    if (/\b(athletic|muscular|fit|lean|wiry|ex-military|soldier)\b/.test(d)) return 'Athletic';
    if (/\b(slender|slim|thin|petite|small|frail)\b/.test(d)) return 'Slender';
    if (/\b(tall|lanky|towering)\b/.test(d)) return 'Tall';
    if (/\b(short|diminutive)\b/.test(d)) return 'Petite';
    return '';
  }

  function fallbackFromClips (name, clips) {
    const up = String(name || '').toUpperCase();
    for (let i = 0; i < (clips || []).length; i++) {
      const clip = clips[i];
      if (!appearsInClip(name, clip)) continue;
      const desc = String(clip.description || '').trim();
      if (desc && desc.length > 12 && !/^Close on\s+/i.test(desc)) {
        return desc.replace(new RegExp('\\b' + up.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), '').replace(/^\s*[,.\-–—:\s]+/, '').trim().slice(0, 280);
      }
      if (clip.dialogue && String(clip.dialogue).trim()) {
        return 'Dialogue in clip ' + (clip.num || (i + 1)) + ': "' + String(clip.dialogue).trim().slice(0, 120) + '"';
      }
    }
    return '';
  }

  function appearsInClip (name, clip) {
    const up = String(name || '').toUpperCase().trim();
    if ((clip.characters || []).some(function (n) { return String(n || '').toUpperCase().trim() === up; })) return true;
    const blob = ((clip.heading || '') + ' ' + (clip.description || '') + ' ' + (clip.dialogue || '')).toUpperCase();
    return blob.indexOf(up) >= 0;
  }

  function extractFromClips (name, clips) {
    const up = String(name || '').toUpperCase();
    const esc = up.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = [];
    (clips || []).forEach(function (clip) {
      if (!appearsInClip(name, clip)) return;
      const desc = String(clip.description || '');
      const dlg = String(clip.dialogue || '');
      const patterns = [
        new RegExp('Close on\\s+' + esc + '\\s*\\(([^)]+)\\)', 'i'),
        new RegExp('\\b' + esc + '\\s*\\(([^)]+)\\)', 'i'),
        new RegExp('\\b' + esc + '\\s*,\\s*([^.!?]{4,160})', 'i')
      ];
      patterns.forEach(function (re) {
        const m = desc.match(re);
        if (!m || !m[1]) return;
        const bit = m[1].trim().replace(/,?\s*delivering dialogue\.?/i, '').trim();
        if (!bit || /^(v\.?o\.?|o\.?s\.?|cont'?d)$/i.test(bit)) return;
        if (parts.indexOf(bit) < 0) parts.push(bit);
      });
      if (dlg && parts.length < 2) {
        const tone = desc.match(/\((whispering|shouting|filtered|into radio|beat|pause)[^)]*\)/i);
        if (tone) parts.push(tone[0].replace(/[()]/g, ''));
      }
    });
    return parts.join('. ').slice(0, 420);
  }

  function enrichAll (characters, scriptText, clips, parseChars) {
    if (!characters || !Object.keys(characters).length) return characters;
    let blob = scriptText || '';
    if (!blob.trim() && clips && clips.length) {
      const parts = [];
      clips.forEach(function (c) {
        if (c.heading) parts.push(c.heading);
        if (c.description) parts.push(c.description);
        if (c.dialogue) parts.push(c.dialogue);
      });
      blob = parts.join('\n');
    }

    Object.keys(characters).forEach(function (name) {
      const c = characters[name];
      if (!c) return;
      const up = String(name).toUpperCase();
      let hint = c.description || '';
      if (parseChars) {
        const parsed = parseChars[up] || parseChars[name];
        if (parsed && String(parsed).trim()) hint = String(parsed).trim();
      }
      const fromClips = extractFromClips(name, clips);
      if (fromClips && fromClips.length > hint.length) hint = fromClips;

      const syn = blob.trim() ? synthesizeDescription(name, blob, hint) : hint;
      let best = [syn, fromClips, hint].filter(Boolean).sort(function (a, b) { return b.length - a.length; })[0] || '';
      if (!best || best.length < 8) {
        const fb = fallbackFromClips(name, clips);
        if (fb && fb.length > (best || '').length) best = fb;
      }

      if (best && (!c.description || !String(c.description).trim() || best.length > String(c.description).length + 4)) {
        c.description = best;
      }
      if (!c.wardrobe || !String(c.wardrobe).trim()) {
        const w = inferWardrobe(c.description);
        if (w) c.wardrobe = w;
      }
      if (!c.bodyType || c.bodyType === 'Average') {
        const b = inferBodyType(c.description);
        if (b) c.bodyType = b;
      }
    });
    return characters;
  }

  function renderList (chars, selected) {
    const names = Object.keys(chars);
    if (!names.length) return '<div class="empty-hint">Characters come from the same script parse as your timeline clips. Re-import your script, or click <strong>+ Add Character</strong>.</div>';
    return '<div class="char-grid">' + names.map(n => {
      const c = chars[n];
      const thumb = c.refUrl ? '<img src="' + esc(c.refUrl) + '" alt="">' : '<span class="ph">👤</span>';
      const lock = c.faceLock ? '<span class="lock-badge">🔒 Face lock</span>' : '';
      const sel = selected === n ? ' selected' : '';
      const preview = (c.description || '').trim().slice(0, 42);
      const roleTag = (c.role && c.role !== 'lead') ? '<span class="lock-badge" style="opacity:.85">' + esc(c.role) + '</span>' : '';
      return '<div class="char-card' + sel + '" data-name="' + esc(n) + '">' +
        '<button type="button" class="char-del" data-del="' + esc(n) + '" title="Delete character" aria-label="Delete ' + esc(n) + '">×</button>' +
        '<div class="char-thumb">' + thumb + '</div>' +
        '<div class="char-name">' + esc(n) + '</div>' +
        (preview ? '<div class="char-meta" style="color:var(--text2);margin-top:2px">' + esc(preview) + (c.description.length > 42 ? '…' : '') + '</div>' : '') +
        lock + roleTag +
        '<div class="char-meta">' + esc(c.emotion || 'Neutral') + ' · ' + esc(c.voice || 'Natural') + '</div></div>';
    }).join('') + '</div>';
  }

  function renderEditor (name, c) {
    if (!name) return '<div class="empty-hint">Select a character to edit face lock, wardrobe, and voice.</div>';
    const hasDesc = !!(c.description && String(c.description).trim());
    return '<div class="char-editor">' +
      '<h4>' + esc(name) + '</h4>' +
      (!hasDesc ? '<div class="empty-hint" style="margin-bottom:8px">No traits parsed yet — click <strong>↻ Sync from parse</strong> or re-import your script. Action lines like <em>NAME (50s, silver hair, suit)</em> fill this automatically.</div>' : '') +
      field('Description', 'description', 'textarea', c.description) +
      field('Body type', 'bodyType', 'select', c.bodyType, ['Slender', 'Average', 'Athletic', 'Stocky', 'Tall', 'Petite']) +
      field('Wardrobe', 'wardrobe', 'input', c.wardrobe) +
      field('Voice profile', 'voice', 'select', c.voice, ['Natural', 'Deep', 'Soft', 'Gravel', 'Young', 'Elder']) +
      field('Default emotion', 'emotion', 'select', c.emotion, ['Neutral', 'Tense', 'Joy', 'Fear', 'Anger', 'Sad', 'Noir']) +
      field('Cast role', 'role', 'select', c.role || 'lead', ['lead', 'supporting', 'background', 'crowd', 'voice_only']) +
      '<div class="field"><label><span>Face lock (I2V)</span><span class="toggle' + (c.faceLock ? ' on' : '') + '" data-k="faceLock"></span></label></div>' +
      '<div class="field"><label><span>Lip-sync enable</span><span class="toggle' + (c.lipSync ? ' on' : '') + '" data-k="lipSync"></span></label></div>' +
      '<div class="field"><label>Lock method</label><select data-k="lockMethod"><option value="ip-adapter"' + (c.lockMethod === 'ip-adapter' ? ' selected' : '') + '>IP-Adapter</option><option value="lora"' + (c.lockMethod === 'lora' ? ' selected' : '') + '>LoRA</option></select></div>' +
      (c.refUrl ? '<div class="ref-preview"><img src="' + esc(c.refUrl) + '" alt="ref"></div>' : '') +
      '<button type="button" class="tb-btn gold" id="btnUploadRef">Upload reference image</button>' +
      (c.refUrl ? '<button type="button" class="tb-btn" id="btnClearRef">Remove reference</button>' : '') +
      '<button type="button" class="tb-btn char-delete-btn" id="btnDeleteChar">Delete character</button>' +
      '</div>';
  }

  function field (label, key, type, val, opts) {
    if (type === 'textarea') return '<div class="field"><label>' + label + '</label><textarea data-k="' + key + '">' + esc(val || '') + '</textarea></div>';
    if (type === 'select') return '<div class="field"><label>' + label + '</label><select data-k="' + key + '">' + opts.map(o => '<option' + (o === val ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></div>';
    return '<div class="field"><label>' + label + '</label><input data-k="' + key + '" value="' + esc(val || '') + '"></div>';
  }

  function esc (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  function getRefForClip (chars, clip) {
    const names = clip.characters || [];
    const rank = { lead: 0, supporting: 1, background: 2, crowd: 9, voice_only: 10 };
    const sorted = names.slice().sort((a, b) => {
      const ra = rank[(chars[a] && chars[a].role) || 'lead'] || 5;
      const rb = rank[(chars[b] && chars[b].role) || 'lead'] || 5;
      return ra - rb;
    });
    for (const n of sorted) {
      const c = chars[n];
      if (!c || c.role === 'crowd' || c.role === 'voice_only') continue;
      if (c.faceLock && c.refUrl && String(c.refUrl).startsWith('https://')) return { url: c.refUrl, name: n };
    }
    for (const n of sorted) {
      const c = chars[n];
      if (!c || c.role === 'crowd' || c.role === 'voice_only') continue;
      if (c.refUrl && String(c.refUrl).startsWith('https://')) return { url: c.refUrl, name: n };
    }
    return null;
  }

  function injectIntoPrompt (prompt, chars, clip) {
    const names = clip.characters || [];
    let extra = '';
    names.forEach(n => {
      const c = chars[n]; if (!c) return;
      if (c.description) extra += ' ' + n + ': ' + c.description.slice(0, 100) + '.';
      if (c.wardrobe) extra += ' Wardrobe: ' + c.wardrobe + '.';
      if (c.emotion) extra += ' Emotion: ' + c.emotion + '.';
      if (c.lipSync && clip.dialogue) extra += ' Lip-sync dialogue.';
    });
    return (prompt + extra).slice(0, 900);
  }

  function inferCastRole (name, clips) {
    const up = String(name || '').toUpperCase().trim().replace(/^(A|AN|THE)\s+/, '');
    const words = up.split(/\s+/).filter(Boolean);
    let hasDialogue = false;
    (clips || []).forEach(function (clip) {
      if (!clip.dialogue) return;
      const inFrame = (clip.characters || []).some(function (n) {
        return String(n || '').toUpperCase().trim() === up;
      });
      if (inFrame) hasDialogue = true;
    });
    if (words.length >= 2) return hasDialogue ? 'supporting' : 'background';
    if (hasDialogue) return 'lead';
    return 'supporting';
  }

  function hydrate (characters, scriptText, clips, parseChars) {
    if (!characters) return characters;
    Object.keys(characters).forEach(function (name) {
      const c = characters[name];
      if (!c) return;
      if (c.desc && !c.description) c.description = c.desc;
      delete c.desc;
    });
    enrichAll(characters, scriptText, clips, parseChars);
    Object.keys(characters).forEach(function (name) {
      const c = characters[name];
      if (!c || (c.description && String(c.description).trim())) return;
      const up = String(name).toUpperCase();
      const fromParse = parseChars && (parseChars[up] || parseChars[name]);
      if (fromParse && String(fromParse).trim()) {
        c.description = String(fromParse).trim();
        return;
      }
      const fb = fallbackFromClips(name, clips);
      if (fb) c.description = fb;
    });
    Object.keys(characters).forEach(function (name) {
      const c = characters[name];
      if (!c) return;
      if (!c.role || c.role === 'lead') c.role = inferCastRole(name, clips);
    });
    return characters;
  }

  return {
    DEFAULTS, normalize, synthesizeDescription, extractFromClips, inferWardrobe, inferBodyType, enrichAll, hydrate,
    renderList, renderEditor, getRefForClip, injectIntoPrompt
  };
})();