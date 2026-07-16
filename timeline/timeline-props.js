/* Module — Prop bible + continuity enrichment client.
   Props previously had NO data model (a free-text field the parser discarded).
   state.propBible = [{ id, name, description, importance:'hero'|'set-dressing',
   refUrl, sceneIndices:[], heldBy }] — hero props get reference cards and ride
   along as image refs on multi-ref models; every in-frame prop is injected
   into the prompt. Also syncs outfits + continuity rules from the
   enrich-continuity agent. */
window.SBProps = (function () {
  'use strict';

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function isHttps(u) { return typeof u === 'string' && u.trim().indexOf('https://') === 0; }

  function ensureProp(p) {
    if (!p.id) p.id = 'prop_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    if (!p.importance) p.importance = 'set-dressing';
    if (!Array.isArray(p.sceneIndices)) p.sceneIndices = [];
    return p;
  }

  function propsForClip(state, clip) {
    const bible = (state && state.propBible) || [];
    if (clip == null || clip.sceneIdx == null) return [];
    return bible.filter(function (p) {
      return p && (p.sceneIndices || []).indexOf(clip.sceneIdx) >= 0;
    });
  }

  /* Merge the enrich-continuity agent's result into state (conservative caps). */
  function mergeEnrichResult(state, data) {
    let n = 0;
    if (!state || !data) return n;

    if (Array.isArray(data.props)) {
      if (!state.propBible) state.propBible = [];
      data.props.slice(0, 40).forEach(function (p) {
        if (!p || !p.name || typeof p.name !== 'string') return;
        const name = p.name.trim().slice(0, 60);
        if (!name) return;
        let entry = state.propBible.find(function (x) { return x.name.toUpperCase() === name.toUpperCase(); });
        if (!entry) {
          entry = ensureProp({ name: name, description: '', refUrl: null, heldBy: '' });
          state.propBible.push(entry);
          n++;
        }
        if (!entry.description && typeof p.description === 'string') entry.description = p.description.slice(0, 300);
        if (p.importance === 'hero' || p.importance === 'set-dressing') entry.importance = p.importance;
        if (typeof p.heldBy === 'string' && !entry.heldBy) entry.heldBy = p.heldBy.slice(0, 60);
        (Array.isArray(p.scenes) ? p.scenes : []).slice(0, 200).forEach(function (si) {
          si = parseInt(si, 10);
          if (Number.isFinite(si) && si >= 0 && entry.sceneIndices.indexOf(si) < 0) entry.sceneIndices.push(si);
        });
      });
    }

    if (data.outfits && typeof data.outfits === 'object' && state.characters) {
      Object.keys(data.outfits).slice(0, 40).forEach(function (rawName) {
        const name = String(rawName).toUpperCase().trim();
        const c = state.characters[name];
        if (!c) return;
        const list = Array.isArray(data.outfits[rawName]) ? data.outfits[rawName] : [];
        if (!c.outfits) c.outfits = [];
        list.slice(0, 20).forEach(function (o) {
          if (!o || typeof o.description !== 'string') return;
          const si = parseInt(o.scene, 10);
          if (!Number.isFinite(si) || si < 0) return;
          const existing = c.outfits.find(function (x) { return x.sceneIdx === si; });
          if (existing) {
            if (!existing.description) { existing.description = o.description.slice(0, 200); n++; }
          } else {
            c.outfits.push({ sceneIdx: si, description: o.description.slice(0, 200), cardUrl: null });
            n++;
          }
        });
        c.outfits.sort(function (a, b) { return a.sceneIdx - b.sceneIdx; });
      });
    }

    if (data.rules && (Array.isArray(data.rules.crowds) || Array.isArray(data.rules.anchors))) {
      const crowds = (data.rules.crowds || []).slice(0, 8).filter(function (r) {
        return r && typeof r.name === 'string' && r.name.trim();
      }).map(function (r) {
        return {
          name: String(r.name).toUpperCase().trim().slice(0, 40).replace(/\s+/g, '_'),
          leaderName: typeof r.leaderName === 'string' ? r.leaderName.toUpperCase().trim().slice(0, 40) : '',
          leaderDescription: typeof r.leaderDescription === 'string' ? r.leaderDescription.slice(0, 400) : '',
          description: typeof r.description === 'string' ? r.description.slice(0, 400) : '',
          leaderNote: typeof r.leaderNote === 'string' ? r.leaderNote.slice(0, 200) : '',
          detectPatterns: (Array.isArray(r.detectPatterns) ? r.detectPatterns : []).slice(0, 6).map(String),
          triggerWords: (Array.isArray(r.triggerWords) ? r.triggerWords : []).slice(0, 10).map(String),
          wideShotWords: (Array.isArray(r.wideShotWords) ? r.wideShotWords : []).slice(0, 10).map(String)
        };
      });
      const anchors = (data.rules.anchors || []).slice(0, 12).filter(function (a) {
        return a && typeof a.canonicalLocation === 'string' && a.canonicalLocation.trim();
      }).map(function (a) {
        return {
          canonicalLocation: a.canonicalLocation.trim().slice(0, 80),
          matchWords: (Array.isArray(a.matchWords) ? a.matchWords : []).slice(0, 10).map(String)
        };
      });
      if (crowds.length || anchors.length) {
        state.continuityRules = { crowds: crowds, anchors: anchors, source: 'enrich', builtAt: Date.now() };
        n++;
      }
    }

    return n;
  }

  /* Call the enrich-continuity agent (props + outfits + crowd/anchor rules). */
  async function enrich(state, hdrs) {
    const scenes = ((state.parseResult && state.parseResult.scenes) || []).map(function (s, i) {
      return { i: i, heading: s.heading || '' };
    });
    const res = await fetch('/.netlify/functions/enrich-continuity', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({
        scriptExcerpt: String(state.scriptText || '').slice(0, 9000),
        scenes: scenes.slice(0, 200),
        characters: Object.keys(state.characters || {}).slice(0, 60)
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || 'Continuity enrich failed');
    return data;
  }

  function renderList(bible, selectedId) {
    bible = bible || [];
    if (!bible.length) {
      return '<div class="empty-hint">No props yet — run ✨ Enrich continuity, or add one manually.</div>';
    }
    return '<div class="loc-grid">' + bible.map(function (p) {
      return '<div class="loc-card' + (selectedId === p.id ? ' selected' : '') + '" data-prop="' + esc(p.id) + '">' +
        '<div class="loc-thumb">' + (isHttps(p.refUrl) ? '<img src="' + esc(p.refUrl) + '" alt="">' : '<span class="ph">🧰</span>') + '</div>' +
        '<div class="loc-name">' + esc(p.name) + (p.importance === 'hero' ? ' <span class="lock-badge">★ hero</span>' : '') + '</div>' +
        '<div class="loc-meta">' + (p.sceneIndices || []).length + ' scenes' + (p.heldBy ? ' · ' + esc(p.heldBy) : '') + '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function renderEditor(prop) {
    if (!prop) return '<div class="empty-hint">Select a prop to describe it and generate a reference card.</div>';
    return '<div class="loc-editor">' +
      '<h4>🧰 ' + esc(prop.name) + '</h4>' +
      '<div class="field"><label>Description (visible details for continuity)</label><textarea data-pk="description">' + esc(prop.description || '') + '</textarea></div>' +
      '<div class="field"><label>Importance</label><select data-pk="importance">' +
        '<option value="hero"' + (prop.importance === 'hero' ? ' selected' : '') + '>Hero prop (gets an image ref)</option>' +
        '<option value="set-dressing"' + (prop.importance !== 'hero' ? ' selected' : '') + '>Set dressing (prompt only)</option>' +
      '</select></div>' +
      '<div class="field"><label>Held by (character, optional)</label><input data-pk="heldBy" value="' + esc(prop.heldBy || '') + '"></div>' +
      (isHttps(prop.refUrl) ? '<div class="ref-preview"><img src="' + esc(prop.refUrl) + '" alt="prop card"></div>' : '') +
      '<button type="button" class="tb-btn gold" id="btnGenPropCard">✨ Generate prop card</button> ' +
      '<button type="button" class="tb-btn char-delete-btn" id="btnDeleteProp">Delete prop</button>' +
      '</div>';
  }

  return {
    ensureProp: ensureProp,
    propsForClip: propsForClip,
    mergeEnrichResult: mergeEnrichResult,
    enrich: enrich,
    renderList: renderList,
    renderEditor: renderEditor
  };
})();
