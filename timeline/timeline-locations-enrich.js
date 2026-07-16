/* Timeline — Location enricher + multi-scene alias merge (Grok via enrich-locations) */
window.SBLocEnrich = (function () {
  function cleanLocName(name) {
    return String(name || '')
      .replace(/^\s*(?:at|inside|outside|near|on)\s+(?:the\s+)?/i, '')
      .replace(/^\s*in\s+(?:the\s+)?/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escRe(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function defaultAnchors() {
    return (window.SBContinuity && SBContinuity.DEFAULT_RULES) ? SBContinuity.DEFAULT_RULES.anchors : [];
  }

  /* Anchor is "in play" for this script if the script mentions the anchor's
     own distinctive proper-noun words — derived from canonicalLocation itself,
     so no per-project hardcoding is needed to gate generic terms (TERMINAL,
     CURB, ...) onto the right named place. */
  function anchorActiveForScript(anchor, scriptText) {
    const text = String(scriptText || '').toUpperCase();
    const skip = { INTERNATIONAL: 1, AIRPORT: 1, TERMINAL: 1, THE: 1, OF: 1 };
    const nameTokens = String(anchor.canonicalLocation || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/)
      .filter(function (w) { return w.length > 3 && !skip[w]; });
    return nameTokens.some(function (t) { return text.indexOf(t) >= 0; });
  }

  /* Data-driven canonical-location resolution — previously hardcoded to
     Pierre Trudeau Airport; anchors defaults to that (DEFAULT_RULES.anchors)
     but any per-project state.continuityRules.anchors overrides it. */
  function canonicalLocName(name, scriptText, anchors) {
    const n = cleanLocName(name);
    if (!n) return '';
    const rules = (anchors && anchors.length) ? anchors : defaultAnchors();
    const nameU = n.toUpperCase();
    for (let i = 0; i < rules.length; i++) {
      const a = rules[i];
      if (!a || !a.canonicalLocation || !anchorActiveForScript(a, scriptText)) continue;
      const hit = (a.matchWords || []).some(function (w) {
        return new RegExp('\\b' + escRe(String(w).toUpperCase()) + '\\b').test(nameU);
      });
      if (hit) return a.canonicalLocation;
    }
    return n;
  }

  function locKey(name, scriptText, anchors) {
    const c = canonicalLocName(name, scriptText, anchors);
    return c ? c.toUpperCase().replace(/\s+/g, ' ') : '';
  }

  function tokenSet(name) {
    return new Set(
      String(name || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter(function (w) {
        return w.length > 2 && !/^(THE|AND|INT|EXT|DAY|NIGHT)$/.test(w);
      })
    );
  }

  /* Any anchor's matchWords count as a topical-overlap bonus regardless of
     which anchor — generalizes the old hardcoded /airport|terminal|tarmac/i
     bonus to whatever anchors are active for this project. */
  function anchorBonusWords(anchors) {
    const words = new Set();
    ((anchors && anchors.length) ? anchors : defaultAnchors()).forEach(function (a) {
      (a.matchWords || []).forEach(function (w) { words.add(String(w).toUpperCase()); });
    });
    return words;
  }

  function buildLocalAliasMap(locationKeys, scriptText, anchors) {
    const names = (locationKeys || []).map(function (k) {
      return cleanLocName(String(k).replace(/_/g, ' '));
    }).filter(Boolean);
    const aliasMap = {};
    const canonGroups = {};
    const bonusWords = anchorBonusWords(anchors);

    names.forEach(function (nm) {
      const ck = locKey(nm, scriptText, anchors);
      if (!ck) return;
      if (!canonGroups[ck]) canonGroups[ck] = [];
      if (canonGroups[ck].indexOf(nm) < 0) canonGroups[ck].push(nm);
    });

    Object.keys(canonGroups).forEach(function (ck) {
      canonGroups[ck].forEach(function (nm) {
        const raw = nm.toUpperCase().replace(/\s+/g, ' ');
        if (raw !== ck) aliasMap[raw] = ck;
      });
    });

    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i];
        const b = names[j];
        const ka = locKey(a, scriptText, anchors);
        const kb = locKey(b, scriptText, anchors);
        if (ka === kb) continue;
        const ta = tokenSet(a);
        const tb = tokenSet(b);
        let shared = 0;
        ta.forEach(function (t) { if (tb.has(t)) shared++; });
        const score = shared / Math.min(ta.size || 1, tb.size || 1);
        const hasBonusTopic = Array.from(ta).some(function (t) { return bonusWords.has(t); })
          && Array.from(tb).some(function (t) { return bonusWords.has(t); });
        // Slightly more aggressive than the original 0.6/0.4 thresholds so
        // near-duplicate sluglines (e.g. minor wording drift) merge on their own.
        if (score >= 0.5 || (score >= 0.35 && hasBonusTopic)) {
          const winner = ka.length >= kb.length ? ka : kb;
          aliasMap[a.toUpperCase().replace(/\s+/g, ' ')] = winner;
          aliasMap[b.toUpperCase().replace(/\s+/g, ' ')] = winner;
        }
      }
    }
    return aliasMap;
  }

  function resolveKey(key, aliasMap, scriptText, anchors) {
    const up = String(key || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (!up) return '';
    if (aliasMap && aliasMap[up]) return aliasMap[up];
    return locKey(up, scriptText, anchors) || up;
  }

  /* Fold single-clip "orphan" locations into a scene-adjacent, larger
     location when the scene transition isn't a hard break and the names
     share some vocabulary — cleans up over-fragmented location bibles
     (e.g. many 1-clip variants of the same set) without an LLM call. */
  function mergeOrphanLocations(state) {
    const bible = state.locationBible || [];
    if (bible.length < 2 || !state.clips) return 0;
    const script = String(state.scriptText || '');
    const scenes = (state.parseResult && state.parseResult.scenes) || [];
    const byKey = {};
    bible.forEach(function (l) { if (l && l.key) byKey[l.key] = l; });
    let merged = 0;

    bible.slice().forEach(function (loc) {
      if (!loc || !byKey[loc.key] || (loc.clipIndices || []).length !== 1) return;
      const ci = loc.clipIndices[0];
      const clip = state.clips[ci];
      if (!clip) return;
      const heading = (clip.sceneIdx != null && scenes[clip.sceneIdx]) ? scenes[clip.sceneIdx].heading : (clip.heading || '');
      const ctype = window.SBContinuity ? SBContinuity.continuityType(heading) : 'new';
      if (ctype === 'break') return;

      [state.clips[ci - 1], state.clips[ci + 1]].filter(Boolean).some(function (nb) {
        const nbRaw = nb.params && nb.params.scene && nb.params.scene.location;
        if (!nbRaw) return false;
        const nbKey = locKey(nbRaw, script);
        const target = byKey[nbKey];
        if (!target || target === loc || (target.clipIndices || []).length < 2) return false;
        const ta = tokenSet(loc.name);
        const tb = tokenSet(target.name);
        let shared = 0;
        ta.forEach(function (t) { if (tb.has(t)) shared++; });
        const score = shared / Math.min(ta.size || 1, tb.size || 1);
        if (score < 0.3) return false;

        target.clipIndices = (target.clipIndices || []).concat(loc.clipIndices.filter(function (x) { return target.clipIndices.indexOf(x) < 0; }));
        if (!target.aliases) target.aliases = [];
        if (loc.key !== target.key && target.aliases.indexOf(loc.key) < 0) target.aliases.push(loc.key);
        clip.params.scene.location = target.name;
        delete byKey[loc.key];
        merged++;
        return true;
      });
    });

    if (merged) state.locationBible = Object.keys(byKey).map(function (k) { return byKey[k]; });
    return merged;
  }

  function buildTrustedLocations(state) {
    const script = String(state.scriptText || '');
    const keys = new Set();
    (state.locationBible || []).forEach(function (loc) {
      if (loc && loc.key) keys.add(String(loc.key).toUpperCase().trim());
      if (loc && loc.name) keys.add(locKey(loc.name, script));
    });
    (state.clips || []).forEach(function (clip) {
      const fields = [
        clip.heading,
        clip.params && clip.params.scene && clip.params.scene.location,
        clip.location,
      ];
      fields.forEach(function (f) {
        const k = locKey(f, script);
        if (k) keys.add(k);
      });
    });
    const scenes = state.parseResult && state.parseResult.scenes;
    if (scenes) {
      scenes.forEach(function (sc) {
        const k = locKey(sc.heading || '', script);
        if (k) keys.add(k);
        if (window.SBParser && window.SBParser.parseSceneHeading) {
          const m = window.SBParser.parseSceneHeading(sc.heading || '');
          if (m && m.key) keys.add(m.key);
        }
      });
    }
    return Array.from(keys).filter(Boolean).sort();
  }

  function buildEvidencePacks(state, trusted) {
    const script = String(state.scriptText || '');
    const packs = {};
    (trusted || []).forEach(function (key) {
      const up = String(key).toUpperCase().trim();
      const loc = (state.locationBible || []).find(function (l) {
        return l && (l.key === up || locKey(l.name, script) === up);
      });
      const headings = [];
      const clipNotes = [];
      (state.clips || []).forEach(function (clip, ci) {
        const clipKey = locKey(
          (clip.params && clip.params.scene && clip.params.scene.location) || clip.heading || '',
          script
        );
        if (clipKey !== up && !String(clip.heading || '').toUpperCase().includes(up.split(' ')[0])) return;
        if (clip.heading && headings.indexOf(clip.heading) < 0) headings.push(clip.heading);
        if (clip.description) clipNotes.push('Clip ' + (clip.num || ci + 1) + ': ' + String(clip.description).slice(0, 180));
      });
      const scenes = state.parseResult && state.parseResult.scenes;
      if (scenes) {
        scenes.forEach(function (sc) {
          const sk = locKey(sc.heading || '', script);
          if (sk === up && sc.heading && headings.indexOf(sc.heading) < 0) headings.push(sc.heading);
        });
      }
      packs[up] = {
        displayName: loc && loc.name ? loc.name : up,
        headings: headings.slice(0, 10),
        clipNotes: clipNotes.slice(0, 8),
        existingDescription: loc && loc.description ? String(loc.description).slice(0, 280) : '',
        existingPhrase: loc && loc.consistencyPhrase ? String(loc.consistencyPhrase).slice(0, 160) : '',
        clipCount: (loc && loc.clipIndices ? loc.clipIndices.length : 0),
        locked: !!(loc && loc.locked),
      };
    });
    return packs;
  }

  function mergeLocationBible(state, aliasMap) {
    const script = String(state.scriptText || '');
    const anchors = window.SBContinuity ? SBContinuity.getRules(state).anchors : null;
    aliasMap = aliasMap || {};
    let bible = (state.locationBible || []).slice();
    const byCanon = {};
    let merged = 0;

    bible.forEach(function (loc) {
      if (!loc) return;
      const rawKey = String(loc.key || locKey(loc.name, script, anchors)).toUpperCase().replace(/\s+/g, ' ');
      const canonKey = resolveKey(rawKey, aliasMap, script, anchors);
      let target = byCanon[canonKey];
      if (!target) {
        target = Object.assign({}, loc, {
          key: canonKey,
          name: canonicalLocName(loc.name || canonKey, script, anchors) || loc.name || canonKey,
          clipIndices: (loc.clipIndices || []).slice(),
          aliases: [],
        });
        byCanon[canonKey] = target;
      } else {
        merged++;
        if (rawKey !== canonKey && target.aliases.indexOf(rawKey) < 0) target.aliases.push(rawKey);
        (loc.clipIndices || []).forEach(function (ci) {
          if (target.clipIndices.indexOf(ci) < 0) target.clipIndices.push(ci);
        });
        if (loc.locked) target.locked = true;
        if (loc.plateUrl && !target.plateUrl) target.plateUrl = loc.plateUrl;
        if (loc.consistencyPhrase && !target.consistencyPhrase) target.consistencyPhrase = loc.consistencyPhrase;
        if (loc.description && (!target.description || loc.description.length > target.description.length)) {
          target.description = loc.description;
        }
      }
    });

    Object.keys(aliasMap).forEach(function (raw) {
      const canon = aliasMap[raw];
      const t = byCanon[canon];
      if (t && t.aliases.indexOf(raw) < 0) t.aliases.push(raw);
    });

    state.locationBible = Object.values(byCanon);
    return { merged: merged, total: state.locationBible.length };
  }

  function applyAliasesToClips(state, aliasMap) {
    const script = String(state.scriptText || '');
    const anchors = window.SBContinuity ? SBContinuity.getRules(state).anchors : null;
    let n = 0;
    (state.clips || []).forEach(function (clip) {
      if (!clip.params) clip.params = { scene: { location: '', on: { location: true } } };
      if (!clip.params.scene) clip.params.scene = { location: '', on: { location: true } };
      const raw = String(clip.params.scene.location || '').trim();
      if (raw) {
        const canon = canonicalLocName(raw, script, anchors);
        const ck = resolveKey(locKey(raw, script, anchors), aliasMap, script, anchors);
        if (canon && canon !== raw) {
          clip.params.scene.location = canon;
          n++;
        } else if (ck && locKey(raw, script, anchors) !== ck) {
          clip.params.scene.location = canonicalLocName(ck, script, anchors);
          n++;
        }
      }
    });
    return n;
  }

  function mergeAgentResult(state, agentData) {
    if (!agentData) return { merged: 0, enriched: 0 };
    const script = String(state.scriptText || '');
    const anchors = window.SBContinuity ? SBContinuity.getRules(state).anchors : null;
    const aliasMap = agentData.aliases || {};
    const mr = mergeLocationBible(state, aliasMap);
    applyAliasesToClips(state, aliasMap);

    let enriched = 0;
    Object.entries(agentData.locations || {}).forEach(function (entry) {
      const key = entry[0];
      const row = entry[1];
      const up = resolveKey(String(key).toUpperCase().trim(), aliasMap, script, anchors);
      const loc = (state.locationBible || []).find(function (l) { return l && l.key === up; });
      if (!loc || !row) return;
      if (row.canonicalName && !loc._nameLocked) loc.name = String(row.canonicalName).trim();
      if (row.description && String(row.description).trim() && !loc._descLocked) {
        loc.description = String(row.description).trim().slice(0, 420);
        enriched++;
      }
      if (row.consistencyPhrase && String(row.consistencyPhrase).trim() && !loc._phraseLocked) {
        loc.consistencyPhrase = String(row.consistencyPhrase).trim().slice(0, 200);
      }
      if (row.atmosphere && !loc.atmosphere) loc.atmosphere = String(row.atmosphere).trim().slice(0, 200);
    });

    if (window.SBLocations && typeof window.SBLocations.syncAll === 'function') {
      state.locationBible = window.SBLocations.syncAll(state, script);
      mergeLocationBible(state, aliasMap);
    }
    if (window.SBContinuity && typeof window.SBContinuity.applyGraph === 'function') {
      window.SBContinuity.applyGraph(state);
    }
    const orphansFolded = mergeOrphanLocations(state);
    return { merged: mr.merged + orphansFolded, enriched: enriched, total: state.locationBible.length };
  }

  async function enrichViaAgent(state, opts) {
    opts = opts || {};
    const script = String(state.scriptText || '');
    const trusted = buildTrustedLocations(state);
    if (!trusted.length) return { ok: false, reason: 'no_locations', merged: 0 };

    const anchors = window.SBContinuity ? SBContinuity.getRules(state).anchors : null;
    const localAliases = buildLocalAliasMap(trusted, script, anchors);
    mergeLocationBible(state, localAliases);
    applyAliasesToClips(state, localAliases);
    mergeOrphanLocations(state);

    let headers = opts.headers || null;
    if (!headers && typeof opts.getHeaders === 'function') {
      try {
        headers = await opts.getHeaders();
      } catch (e) {
        return { ok: false, reason: 'not_signed_in', fallback: true, merged: Object.keys(localAliases).length };
      }
    }
    if (!headers) {
      return { ok: true, merged: Object.keys(localAliases).length, enriched: 0, localOnly: true };
    }

    const payload = {
      trustedKeys: trusted,
      evidence: buildEvidencePacks(state, trusted),
      scriptExcerpt: script.slice(0, 7000),
      anchors: anchors || undefined,
    };

    try {
      const res = await fetch('/.netlify/functions/enrich-locations', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(function () { return {}; });

      if (data.fallback) {
        const lr = mergeAgentResult(state, { aliases: Object.assign({}, localAliases, data.aliases || {}), locations: {} });
        return {
          ok: false,
          reason: data.detail || data.error || 'AI unavailable',
          fallback: true,
          merged: lr.merged,
          enriched: lr.enriched,
        };
      }

      if (!res.ok) {
        return { ok: false, reason: data.error || ('HTTP ' + res.status), fallback: !!data.fallback, merged: 0 };
      }

      const lr = mergeAgentResult(state, data);
      return {
        ok: true,
        merged: lr.merged,
        enriched: lr.enriched,
        total: data.total || trusted.length,
        provider: data.provider || 'grok',
      };
    } catch (e) {
      const lr = mergeAgentResult(state, { aliases: localAliases, locations: {} });
      return { ok: false, reason: e.message || 'network', fallback: true, merged: lr.merged, enriched: lr.enriched };
    }
  }

  return {
    canonicalLocName: canonicalLocName,
    locKey: locKey,
    buildLocalAliasMap: buildLocalAliasMap,
    mergeLocationBible: mergeLocationBible,
    applyAliasesToClips: applyAliasesToClips,
    mergeOrphanLocations: mergeOrphanLocations,
    enrichViaAgent: enrichViaAgent,
    mergeAgentResult: mergeAgentResult,
  };
})();