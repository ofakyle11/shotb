/* CINAMATE Writer — treatment → screenplay engine.
 *
 * Takes the plain text of a film treatment (extracted from PDF via pdf.js,
 * DOCX via JSZip + OOXML, or pasted) and structures it into scene beats,
 * then emits an industry-standard Fountain screenplay draft.
 *
 * All original code, written for Cinamate. Fountain is an open plain-text
 * screenplay format (fountain.io, public spec); OOXML paragraph extraction
 * follows the published ECMA-376 element names.
 */
(function (root) {
  'use strict';

  /* ── text utilities ─────────────────────────────────────────────── */
  function decodeEntities(s) {
    return String(s)
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  /* OOXML word/document.xml → array of paragraph strings.
   * Handles <w:t> runs, <w:tab/> and <w:br/>; ignores everything else. */
  function docxParagraphs(xml) {
    var out = [];
    var paras = String(xml).match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [];
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i];
      var text = '';
      var tokens = p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g) || [];
      for (var j = 0; j < tokens.length; j++) {
        var tk = tokens[j];
        if (tk.indexOf('<w:tab') === 0) text += ' ';
        else if (tk.indexOf('<w:br') === 0) text += '\n';
        else text += decodeEntities(tk.replace(/^<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>$/, ''));
      }
      out.push(text);
    }
    return out;
  }

  /* Normalize extracted text: unify newlines, drop page furniture,
   * de-hyphenate line wraps, and rebuild paragraphs (PDF extraction gives
   * hard-wrapped lines; a blank line is the real paragraph break). */
  function cleanText(t) {
    var s = String(t || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n');
    // page numbers / "Page 3 of 12" alone on a line
    s = s.replace(/^\s*(?:page\s+)?\d+(?:\s+of\s+\d+)?\s*$/gim, '');
    // word-\nwrap → wordwrap
    s = s.replace(/([a-z])-\n([a-z])/g, '$1$2');
    var lines = s.split('\n');
    var out = [];
    var buf = '';
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].replace(/\s+$/, '');
      var trimmed = ln.trim();
      if (!trimmed) { if (buf) { out.push(buf); buf = ''; } out.push(''); continue; }
      if (isHeadingLine(trimmed)) { if (buf) { out.push(buf); buf = ''; } out.push(trimmed); out.push(''); continue; }
      buf = buf ? buf + ' ' + trimmed : trimmed;
    }
    if (buf) out.push(buf);
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ── structure detection ────────────────────────────────────────── */
  var SLUG_RE = /^(INT|EXT|INT\/EXT|I\/E|EST)[.\s]/i;
  function isSlugline(line) { return SLUG_RE.test(line.trim()); }

  function isHeadingLine(line) {
    var t = line.trim();
    if (!t || t.length > 90) return false;
    if (isSlugline(t)) return true;
    if (/^(ACT|PART|CHAPTER|SEQUENCE|SCENE|BEAT)\b[\s\dIVX:.-]*/i.test(t) && t.length < 40) return true;
    if (/^#{1,4}\s/.test(t)) return true;                       // markdown-ish
    if (/^\d{1,3}[.)]\s+\S/.test(t) && t.length < 80) return true; // "12. THE HEIST"
    // ALL-CAPS line (allow digits/punct), at least 2 letters, no sentence period run-on
    var letters = t.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 3 && letters === letters.toUpperCase() && !/[.!?]\s+\w+\s+\w/.test(t)) return true;
    return false;
  }

  var INT_CUES = /\b(inside|interior|room|office|kitchen|bedroom|apartment|house(?!\s*(?:exterior|outside))|hallway|corridor|lab|classroom|hospital|church|bar|diner|car|cockpit|cabin|basement|attic|warehouse|studio|elevator|train|bus)\b/i;
  var EXT_CUES = /\b(outside|exterior|street|road|highway|field|forest|woods|beach|desert|mountain|rooftop|alley|park|yard|parking lot|dock|harbor|bridge|battlefield|jungle|lake|river|ocean|cliff|farm)\b/i;
  var NIGHT_CUES = /\b(night|midnight|evening|dusk|sunset|dark(?:ness)?|moonlight|2\s*a\.?m\.?|3\s*a\.?m\.?)\b/i;
  var DAY_CUES = /\b(day|morning|dawn|sunrise|noon|afternoon|daylight|sunny)\b/i;

  function guessSlug(heading, body) {
    var h = String(heading || '').trim();
    var b = String(body || '');
    if (isSlugline(h)) {
      // already a slugline — normalize separators and case
      var norm = h.toUpperCase().replace(/\s*[-–—]\s*/g, ' - ').replace(/\s+/g, ' ').trim();
      if (!/ - [A-Z ]+$/.test(norm)) norm += NIGHT_CUES.test(b) ? ' - NIGHT' : ' - DAY';
      return norm;
    }
    var intExt = INT_CUES.test(b) && !EXT_CUES.test(b) ? 'INT.' :
      EXT_CUES.test(b) && !INT_CUES.test(b) ? 'EXT.' :
      INT_CUES.test(b) ? 'INT./EXT.' : 'EXT.';
    var tod = NIGHT_CUES.test(b) && !DAY_CUES.test(b) ? 'NIGHT' : 'DAY';
    var loc = h.replace(/^#{1,4}\s*/, '').replace(/^\d{1,3}[.)]\s*/, '')
      .replace(/^(ACT|PART|CHAPTER|SEQUENCE|SCENE|BEAT)\b[\s\dIVX:.-]*/i, '').trim();
    if (!loc) {
      // pull a location cue from the body
      var m = b.match(EXT_CUES) || b.match(INT_CUES);
      loc = m ? m[0] : 'LOCATION';
    }
    return intExt + ' ' + loc.toUpperCase().slice(0, 48) + ' - ' + tod;
  }

  var NAME_STOP = { THE: 1, AND: 1, BUT: 1, WITH: 1, FROM: 1, INTO: 1, THEN: 1, WHEN: 1, THEY: 1, SHE: 1, HER: 1, HIS: 1, HIM: 1, OUR: 1, WE: 1, IT: 1, ITS: 1, THIS: 1, THAT: 1, NOT: 1, FOR: 1, ACT: 1, INT: 1, EXT: 1, DAY: 1, NIGHT: 1, CUT: 1, FADE: 1, SCENE: 1, TITLE: 1, LATER: 1, MEANWHILE: 1, SUDDENLY: 1 };
  function extractCharacters(text) {
    var counts = {};
    var s = String(text || '');
    // ALL-CAPS names as written in treatments ("MARA (30s) enters")
    var caps = s.match(/\b[A-Z][A-Z'’.-]{2,18}\b/g) || [];
    for (var i = 0; i < caps.length; i++) {
      var w = caps[i].replace(/[.']/g, '');
      if (NAME_STOP[w] || w.length < 3) continue;
      counts[w] = (counts[w] || 0) + 2; // caps mention weighs double
    }
    // TitleCase words that repeat (proper nouns in prose)
    var words = s.match(/(?:^|[^.!?]\s)([A-Z][a-z]{2,14})\b/g) || [];
    for (var j = 0; j < words.length; j++) {
      var t = words[j].replace(/^.*\s/, '');
      var up = t.toUpperCase();
      if (NAME_STOP[up]) continue;
      counts[up] = (counts[up] || 0) + 1;
    }
    return Object.keys(counts).filter(function (k) { return counts[k] >= 2; })
      .sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 12);
  }

  /* ── treatment → scene beats ────────────────────────────────────── */
  function parseTreatment(text, opts) {
    opts = opts || {};
    var t = cleanText(text);
    var blocks = t.split(/\n{2,}/).map(function (b) { return b.trim(); }).filter(Boolean);
    var proj = { title: opts.title || '', author: opts.author || '', logline: '' };
    var scenes = [];
    var cur = null;
    var started = false;

    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var firstLine = b.split('\n')[0];

      // front matter: title / byline / logline before any scene begins
      if (!started && !scenes.length) {
        if (!proj.title && b.length < 80 && !isSlugline(b) && i === 0) { proj.title = b.replace(/^#\s*/, '').replace(/\bA (FILM )?TREATMENT\b.*$/i, '').trim(); continue; }
        var by = b.match(/^(?:written\s+)?by[:\s]+(.{2,60})$/i);
        if (!proj.author && by) { proj.author = by[1].trim(); continue; }
        var log = b.match(/^log\s?line[:\s—-]+([\s\S]{5,400})$/i);
        if (log) { proj.logline = log[1].trim(); continue; }
      }

      if (isHeadingLine(firstLine)) {
        started = true;
        var rest = b.split('\n').slice(1).join('\n').trim();
        cur = { heading: firstLine, body: rest ? [rest] : [] };
        scenes.push(cur);
        continue;
      }
      if (cur) { cur.body.push(b); continue; }
      // prose before any heading — becomes its own beat
      started = true;
      cur = { heading: '', body: [b] };
      scenes.push(cur);
      cur = null; // each leading paragraph = one beat until a heading appears
    }

    var out = scenes.map(function (s, idx) {
      var body = s.body.join('\n\n');
      return {
        n: idx + 1,
        heading: s.heading,
        slug: guessSlug(s.heading, body || s.heading),
        body: body,
        characters: extractCharacters((s.heading || '') + ' ' + body)
      };
    });
    if (!proj.title) proj.title = 'Untitled';
    return { project: proj, scenes: out };
  }

  /* ── dialogue passthrough: NAME: "line" inside treatment prose ──── */
  function bodyToFountain(body) {
    var out = [];
    var paras = String(body || '').split(/\n{2,}/);
    var QUOTED = /([A-Z][A-Za-z .'-]{1,24}):\s*[“"']([^”"']{1,400})[”"']/g;
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i].trim();
      if (!p) continue;
      // whole paragraph is a cue, quoted or not
      var m = p.match(/^([A-Z][A-Za-z .'-]{1,24}):\s*[“"']?([\s\S]+?)[”"']?$/);
      if (m && m[2].length < 400 && !/[:;]\s/.test(m[2])) {
        out.push(m[1].toUpperCase().trim() + '\n' + m[2].trim());
        continue;
      }
      // quoted cues embedded mid-paragraph: split action around each one
      var last = 0, piece, found = false;
      QUOTED.lastIndex = 0;
      while ((piece = QUOTED.exec(p))) {
        found = true;
        var before = p.slice(last, piece.index).trim();
        if (before) out.push(before);
        out.push(piece[1].toUpperCase().trim() + '\n' + piece[2].trim());
        last = piece.index + piece[0].length;
      }
      if (found) {
        var after = p.slice(last).trim();
        if (after) out.push(after);
      } else {
        out.push(p);
      }
    }
    return out.join('\n\n');
  }

  function toFountain(parsed, opts) {
    opts = opts || {};
    var p = parsed.project || {};
    var lines = [];
    lines.push('Title: ' + (p.title || 'Untitled'));
    lines.push('Credit: Written by');
    lines.push('Author: ' + (p.author || ''));
    if (opts.draftDate) lines.push('Draft date: ' + opts.draftDate);
    lines.push('Source: Treatment developed in CINAMATE Writer');
    lines.push('');
    if (p.logline) { lines.push('= ' + p.logline); lines.push(''); }
    var scenes = parsed.scenes || [];
    for (var i = 0; i < scenes.length; i++) {
      var s = scenes[i];
      lines.push(s.slug);
      lines.push('');
      var body = bodyToFountain(s.body || '');
      if (body) { lines.push(body); lines.push(''); }
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function stats(parsed) {
    var scenes = parsed.scenes || [];
    var words = 0;
    var chars = {};
    scenes.forEach(function (s) {
      words += (s.body || '').split(/\s+/).filter(Boolean).length;
      (s.characters || []).forEach(function (c) { chars[c] = 1; });
    });
    // a treatment page ≈ 450 words; expands to roughly 3–4 screenplay pages
    var treatPages = Math.max(1, Math.round(words / 450));
    return {
      scenes: scenes.length,
      words: words,
      characters: Object.keys(chars),
      treatmentPages: treatPages,
      estScreenplayPages: Math.round(treatPages * 3.5),
      estRuntimeMin: Math.round(treatPages * 3.5) // 1 page ≈ 1 minute
    };
  }

  root.TWriter = {
    decodeEntities: decodeEntities,
    docxParagraphs: docxParagraphs,
    cleanText: cleanText,
    isHeadingLine: isHeadingLine,
    isSlugline: isSlugline,
    guessSlug: guessSlug,
    extractCharacters: extractCharacters,
    parseTreatment: parseTreatment,
    toFountain: toFountain,
    stats: stats
  };
})(typeof window !== 'undefined' ? window : globalThis);
