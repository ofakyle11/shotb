/* TScript — draft diffing (colored-page revision workflow) and
 * SRT / WebVTT caption parsing & writing.
 *
 * The diff is an original longest-common-subsequence line differ; the
 * caption code implements the public SRT and WebVTT file formats from
 * their specifications. All original code, written for Cinamate.
 */
(function (root) {
  'use strict';

  /* ── line diff (LCS) ─────────────────────────────────────────────
   * Returns ops: {type:'same'|'add'|'del', line} in order.
   */
  function diffLines(aText, bText) {
    var a = String(aText || '').split(/\r?\n/);
    var b = String(bText || '').split(/\r?\n/);
    var n = a.length, m = b.length;
    // LCS table (row-compressed would save memory; scripts are small enough)
    var dp = [];
    for (var i = n; i >= 0; i--) {
      dp[i] = new Int32Array(m + 1);
      for (var j = m; j >= 0; j--) {
        if (i === n || j === m) dp[i][j] = 0;
        else if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var ops = [], x = 0, y = 0;
    while (x < n && y < m) {
      if (a[x] === b[y]) { ops.push({ type: 'same', line: a[x] }); x++; y++; }
      else if (dp[x + 1][y] >= dp[x][y + 1]) { ops.push({ type: 'del', line: a[x] }); x++; }
      else { ops.push({ type: 'add', line: b[y] }); y++; }
    }
    while (x < n) { ops.push({ type: 'del', line: a[x++] }); }
    while (y < m) { ops.push({ type: 'add', line: b[y++] }); }
    return ops;
  }

  function diffStats(ops) {
    var add = 0, del = 0;
    ops.forEach(function (o) { if (o.type === 'add') add++; else if (o.type === 'del') del++; });
    return { added: add, deleted: del, changed: add + del };
  }

  /* Industry colored-page revision order (production convention). */
  var REV_COLORS = ['White', 'Blue', 'Pink', 'Yellow', 'Green', 'Goldenrod', 'Buff', 'Salmon', 'Cherry', '2nd Blue', '2nd Pink'];
  var REV_HEX = { White: '#E8EEF2', Blue: '#7FA8CC', Pink: '#D8A0B8', Yellow: '#D8C878', Green: '#8FBF9F', Goldenrod: '#C9A86C', Buff: '#C8B89A', Salmon: '#D8A088', Cherry: '#C97878', '2nd Blue': '#5B8DB8', '2nd Pink': '#C880A8' };
  function revColor(n) { return REV_COLORS[Math.min(n, REV_COLORS.length - 1)]; }
  function revHex(name) { return REV_HEX[name] || '#E8EEF2'; }

  /* ── captions: SRT + WebVTT (public formats) ─────────────────── */
  function tcToMs(tc) {
    var m = String(tc).trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})$/);
    if (!m) {
      m = String(tc).trim().match(/^(\d{1,2}):(\d{2})[.,](\d{1,3})$/); // VTT MM:SS.mmm
      if (!m) return null;
      return (+m[1] * 60 + +m[2]) * 1000 + +String(m[3]).padEnd(3, '0');
    }
    return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +String(m[4]).padEnd(3, '0');
  }
  function msToTc(ms, vtt) {
    ms = Math.max(0, Math.round(ms));
    var h = Math.floor(ms / 3600000), mn = Math.floor(ms / 60000) % 60,
      s = Math.floor(ms / 1000) % 60, f = ms % 1000;
    return String(h).padStart(2, '0') + ':' + String(mn).padStart(2, '0') + ':' +
      String(s).padStart(2, '0') + (vtt ? '.' : ',') + String(f).padStart(3, '0');
  }

  /* Parse SRT or WebVTT into [{start,end,text}] (ms). */
  function parseCaptions(src) {
    src = String(src || '').replace(/^﻿/, '').replace(/\r/g, '');
    var blocks = src.split(/\n\n+/);
    var cues = [];
    blocks.forEach(function (b) {
      var lines = b.split('\n').filter(function (l) { return l !== ''; });
      if (!lines.length) return;
      if (/^WEBVTT/i.test(lines[0]) || /^NOTE/.test(lines[0]) || /^STYLE/.test(lines[0])) return;
      var ti = lines.findIndex(function (l) { return l.indexOf('-->') >= 0; });
      if (ti < 0) return;
      var tm = lines[ti].split('-->');
      var start = tcToMs(tm[0]), end = tcToMs((tm[1] || '').split(' ')[1] || tm[1]);
      if (start == null || end == null) return;
      cues.push({ start: start, end: end, text: lines.slice(ti + 1).join('\n') });
    });
    cues.sort(function (a, b) { return a.start - b.start; });
    return cues;
  }
  function toSrt(cues) {
    return cues.map(function (c, i) {
      return (i + 1) + '\n' + msToTc(c.start) + ' --> ' + msToTc(c.end) + '\n' + c.text;
    }).join('\n\n') + '\n';
  }
  function toVtt(cues) {
    return 'WEBVTT\n\n' + cues.map(function (c) {
      return msToTc(c.start, true) + ' --> ' + msToTc(c.end, true) + '\n' + c.text;
    }).join('\n\n') + '\n';
  }
  /* QC per common broadcast conventions: reading speed & line length. */
  function captionQc(cues) {
    var issues = [];
    cues.forEach(function (c, i) {
      var dur = (c.end - c.start) / 1000;
      var chars = c.text.replace(/\n/g, '').length;
      if (dur <= 0) issues.push({ cue: i + 1, kind: 'time', msg: 'end before start' });
      else if (chars / dur > 20) issues.push({ cue: i + 1, kind: 'cps', msg: Math.round(chars / dur) + ' chars/sec (max ~20)' });
      c.text.split('\n').forEach(function (l) {
        if (l.length > 42) issues.push({ cue: i + 1, kind: 'line', msg: l.length + ' chars on one line (max ~42)' });
      });
      if (c.text.split('\n').length > 2) issues.push({ cue: i + 1, kind: 'lines', msg: '3+ lines' });
      if (i && c.start < cues[i - 1].end) issues.push({ cue: i + 1, kind: 'overlap', msg: 'overlaps previous cue' });
    });
    return issues;
  }

  root.TScript = {
    diffLines: diffLines, diffStats: diffStats,
    REV_COLORS: REV_COLORS, revColor: revColor, revHex: revHex,
    tcToMs: tcToMs, msToTc: msToTc,
    parseCaptions: parseCaptions, toSrt: toSrt, toVtt: toVtt, captionQc: captionQc
  };
})(typeof window !== 'undefined' ? window : globalThis);
