'use strict';

function cleanLocName(name) {
  return String(name || '')
    .replace(/^\s*(?:at|inside|outside|near|on)\s+(?:the\s+)?/i, '')
    .replace(/^\s*in\s+(?:the\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Default anchor set — mirrors timeline/timeline-continuity.js DEFAULT_RULES.anchors
// so the deterministic fallback behaves the same client and server side. A
// per-project anchor list (built by enrich-continuity) can override this via
// the `anchors` param on canonicalLocName/locKey/buildAliasMap.
const DEFAULT_ANCHORS = [{
  canonicalLocation: 'Pierre Trudeau International Airport',
  matchWords: ['AIRPORT', 'TARMAC', 'TRUDEAU', 'TERMINAL', 'RUNWAY', 'CURB'],
}];

function escRe(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function anchorActiveForScript(anchor, scriptText) {
  const text = String(scriptText || '').toUpperCase();
  const skip = { INTERNATIONAL: 1, AIRPORT: 1, TERMINAL: 1, THE: 1, OF: 1 };
  const nameTokens = String(anchor.canonicalLocation || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 3 && !skip[w]);
  return nameTokens.some((t) => text.indexOf(t) >= 0);
}

/** Deterministic canonical location — same physical place → same key. */
function canonicalLocName(name, scriptText, anchors) {
  const n = cleanLocName(name);
  if (!n) return '';
  const rules = (anchors && anchors.length) ? anchors : DEFAULT_ANCHORS;
  const nameU = n.toUpperCase();
  for (const a of rules) {
    if (!a || !a.canonicalLocation || !anchorActiveForScript(a, scriptText)) continue;
    const hit = (a.matchWords || []).some((w) => new RegExp('\\b' + escRe(String(w).toUpperCase()) + '\\b').test(nameU));
    if (hit) return a.canonicalLocation;
  }
  return n;
}

function locKey(name, scriptText, anchors) {
  const n = canonicalLocName(name, scriptText, anchors);
  return n ? n.toUpperCase().replace(/\s+/g, ' ') : '';
}

function tokenSet(name) {
  return new Set(
    String(name || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter(function (w) {
      return w.length > 2 && !/^(THE|AND|INT|EXT|DAY|NIGHT)$/.test(w);
    })
  );
}

function tokenOverlapScore(a, b) {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  ta.forEach(function (t) { if (tb.has(t)) shared++; });
  return shared / Math.min(ta.size, tb.size);
}

function anchorBonusWords(anchors) {
  const words = new Set();
  ((anchors && anchors.length) ? anchors : DEFAULT_ANCHORS).forEach((a) => {
    (a.matchWords || []).forEach((w) => words.add(String(w).toUpperCase()));
  });
  return words;
}

/** Build alias map: rawKey → canonicalKey for entries that are the same place. */
function buildAliasMap(locationNames, scriptText, anchors) {
  const names = (locationNames || []).map(cleanLocName).filter(Boolean);
  const canonByName = {};
  names.forEach(function (nm) {
    canonByName[nm] = locKey(nm, scriptText || '', anchors);
  });

  const groups = {};
  names.forEach(function (nm) {
    const ck = canonByName[nm];
    if (!ck) return;
    if (!groups[ck]) groups[ck] = [];
    if (groups[ck].indexOf(nm) < 0) groups[ck].push(nm);
  });

  const aliasMap = {};
  Object.keys(groups).forEach(function (canonKey) {
    const members = groups[canonKey];
    if (members.length < 2) return;
    members.forEach(function (nm) {
      const rawKey = nm.toUpperCase().replace(/\s+/g, ' ');
      if (rawKey !== canonKey) aliasMap[rawKey] = canonKey;
    });
  });

  const bonusWords = anchorBonusWords(anchors);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      const ka = canonByName[a];
      const kb = canonByName[b];
      if (ka === kb) continue;
      const score = tokenOverlapScore(a, b);
      const hasBonusTopic = Array.from(tokenSet(a)).some((t) => bonusWords.has(t))
        && Array.from(tokenSet(b)).some((t) => bonusWords.has(t));
      if (score >= 0.5 || (score >= 0.35 && hasBonusTopic)) {
        const winner = ka.length >= kb.length ? ka : kb;
        aliasMap[a.toUpperCase().replace(/\s+/g, ' ')] = winner;
        aliasMap[b.toUpperCase().replace(/\s+/g, ' ')] = winner;
      }
    }
  }

  return aliasMap;
}

function applyAliasMapToKey(key, aliasMap) {
  const up = String(key || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!up) return '';
  if (aliasMap && aliasMap[up]) return aliasMap[up];
  return up;
}

module.exports = {
  cleanLocName,
  locKey,
  canonicalLocName,
  DEFAULT_ANCHORS,
  buildAliasMap,
  applyAliasMapToKey,
  tokenOverlapScore,
};