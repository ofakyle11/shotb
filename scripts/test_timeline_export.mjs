#!/usr/bin/env node
/* Node checks for the Studio's turnover exporter — timeline/timeline-export.js.
 *
 * This file shipped 131 lines with no suite at all, and the thing it got wrong
 * was the first line of it: ftc() computed the hours field as
 * Math.floor(frames / fps), which is the count of whole SECONDS. A one-hour
 * cut exported as 3600:00:00:00 and no finishing house could conform it.
 *
 * The reason nobody noticed is worth writing down, because it decides what
 * this suite has to contain: at any duration under one minute the seconds and
 * the hours field carry the same number, so a fixture built from a handful of
 * four-second clips prints a plausible-looking timecode either way. The bug is
 * only visible at magnitude. Every case below therefore names a real cut
 * length — an hour, ninety minutes, and a sub-second trim — rather than the
 * short fixtures that let this live.
 *
 * The exporter is a browser IIFE, so it gets exactly the browser it asks for:
 * a window to hang itself off, and a recording <a> so a download's CONTENT can
 * be asserted instead of merely its existence.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/* ── the smallest browser that runs this module ── */
const downloads = [];
let lastBlob = null;
class FakeBlob {
  constructor(parts, opts) { lastBlob = this; this.parts = parts; this.type = (opts && opts.type) || ''; }
  text() { return this.parts.map(String).join(''); }
}
globalThis.Blob = FakeBlob;
globalThis.URL = { createObjectURL: () => 'blob:cinamate-test', revokeObjectURL: () => {} };
globalThis.document = {
  createElement() {
    const a = { href: '', download: '', click() { downloads.push({ name: a.download, blob: lastBlob }); } };
    return a;
  },
};
globalThis.window = globalThis.window || {};

(0, eval)(readFileSync(join(ROOT, 'editor/lib-cut.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'timeline/timeline-export.js'), 'utf8'));
const X = globalThis.window.SBExport;
const C = globalThis.window.CCut;

let failed = 0;
function ok(cond, name) {
  if (cond) console.log('  ok  ', name);
  else { console.error('  FAIL', name); failed = 1; }
}
function eq(actual, expected, name) {
  ok(actual === expected, name + (actual === expected ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`));
}

/* ── the module is really there ── */
ok(X && typeof X.ftc === 'function' && typeof X.buildEDL === 'function', 'SBExport exports ftc and buildEDL');

/* ═══ ftc: the field the defect lived in ═══════════════════════════════════
   Frames in, 'HH:MM:SS:FF' out. Non-drop, so the frame field counts against
   the nominal integer rate and rolls over at exactly fps. */

eq(X.ftc(0, 24), '00:00:00:00', 'ftc: zero');

/* sub-second — every one of these has an hours field of 00, which is the
   magnitude at which the old body looked right. */
eq(X.ftc(1, 24), '00:00:00:01', 'ftc: one frame @24');
eq(X.ftc(12, 24), '00:00:00:12', 'ftc: half a second @24 is 12 frames');
eq(X.ftc(23, 24), '00:00:00:23', 'ftc: last frame before the second rolls');
eq(X.ftc(24, 24), '00:00:01:00', 'ftc: the frame field rolls at fps, not at 100');
eq(X.ftc(29, 30), '00:00:00:29', 'ftc: sub-second @30 keeps 29 frames');
eq(X.ftc(30, 30), '00:00:01:00', 'ftc: one second @30');

/* one hour — the reported defect, exactly. */
eq(X.ftc(24 * 3600, 24), '01:00:00:00', 'ftc: ONE HOUR @24 is 01:00:00:00 (was 3600:00:00:00)');
eq(X.ftc(30 * 3600, 30), '01:00:00:00', 'ftc: one hour @30 is 01:00:00:00');
ok(!/^\d{3,}:/.test(X.ftc(24 * 3600, 24)), 'ftc: the hours field is hours, not a seconds count');

/* ninety minutes — a feature runtime, and past the point where minutes wrap. */
eq(X.ftc(24 * 5400, 24), '01:30:00:00', 'ftc: NINETY MINUTES @24 is 01:30:00:00');
eq(X.ftc(30 * 5400, 30), '01:30:00:00', 'ftc: ninety minutes @30 is 01:30:00:00');
eq(X.ftc(24 * 5400 - 1, 24), '01:29:59:23', 'ftc: the frame before 90:00 is 01:29:59:23');

/* every field carrying at once */
eq(X.ftc(24 * 3661 + 12, 24), '01:01:01:12', 'ftc: hours, minutes, seconds and frames together');
eq(X.ftc(24 * 36000, 24), '10:00:00:00', 'ftc: ten hours still pads to two digits');

/* the arithmetic is monotonic across the whole hour boundary — a sort by
   timecode string has to match a sort by frame count, or an EDL reorders. */
{
  let mono = true, prev = '';
  for (const f of [0, 1, 23, 24, 24 * 59, 24 * 60, 24 * 3599, 24 * 3600, 24 * 3601, 24 * 5400]) {
    const s = X.ftc(f, 24);
    if (s <= prev) mono = false;
    prev = s;
  }
  ok(mono, 'ftc: string order matches frame order across the minute and hour rolls');
}

/* ── ftc agrees with the editor's timecode, which is the other implementation
      of this exact concept in the repo. Two turnover files from one cut that
      disagree by an hour is the whole failure this fixes. ── */
{
  let agree = true, firstBad = null;
  for (const fps of [24, 30]) {
    for (const f of [0, 7, 24, 1000, fps * 60, fps * 3600, fps * 5400, fps * 3661 + 5]) {
      const a = X.ftc(f, fps), b = C.tc(f / fps, fps);
      if (a !== b) { agree = false; firstBad = firstBad || `${f}f@${fps}: SBExport ${a} vs CCut ${b}`; }
    }
  }
  ok(agree, 'ftc agrees with CCut.tc at every magnitude' + (firstBad ? ' — ' + firstBad : ''));
}

/* ── normFps: the rate is never guessed twice ── */
eq(X.normFps(undefined), 24, 'normFps: missing rate falls back to 24');
eq(X.normFps(0), 24, 'normFps: zero is not a frame rate');
eq(X.normFps(-30), 24, 'normFps: negative is not a frame rate');
eq(X.normFps('abc'), 24, 'normFps: nonsense is not a frame rate');
eq(X.normFps('30'), 30, 'normFps: a numeric string is a rate');
eq(X.normFps(25), 25, 'normFps: 25 survives');
eq(X.ftc(3600 * 24, undefined), '01:00:00:00', 'ftc: an absent rate still lands on the hour at the default 24');

/* ═══ buildEDL: the record timecodes a conform actually reads ═══════════════ */

const clip = (num, durationSec, extra) => Object.assign({ num, label: 'Clip ' + num, durationSec }, extra || {});

/* a one-hour cut, one event */
{
  const edl = X.buildEDL([clip(1, 3600)], 24);
  ok(edl.startsWith('TITLE: CINAMATE TIMELINE\nFCM: NON-DROP FRAME\n'), 'edl: CMX header');
  ok(edl.includes('* FRAME RATE: 24'), 'edl: the rate it was counted at is stamped in the file');
  ok(edl.includes('00:00:00:00 01:00:00:00 00:00:00:00 01:00:00:00'), 'edl: a one-hour clip runs to 01:00:00:00');
  ok(!/\d{3,}:\d\d:\d\d:\d\d/.test(edl), 'edl: no four-digit hours anywhere in a one-hour cut');
}

/* ninety minutes as two 45-minute reels — the record head of event 2 must be
   the record tail of event 1, or the second reel lands on top of the first. */
{
  const edl = X.buildEDL([clip(1, 2700), clip(2, 2700)], 24);
  ok(edl.includes('001  CLIP_01  V     C        00:00:00:00 00:45:00:00 00:00:00:00 00:45:00:00'), 'edl: reel 1 occupies 00:00–00:45');
  ok(edl.includes('002  CLIP_02  V     C        00:00:00:00 00:45:00:00 00:45:00:00 01:30:00:00'), 'edl: reel 2 butts on at 00:45 and ends at 01:30');
}

/* sub-second trims — the class the old code destroyed twice over: it rounded
   the seconds to a whole number BEFORE converting to frames. */
{
  const edl = X.buildEDL([clip(1, 0.5), clip(2, 0.25)], 24);
  ok(edl.includes('00:00:00:00 00:00:00:12 00:00:00:00 00:00:00:12'), 'edl: a half-second clip is 12 frames, not 0 and not 1s');
  ok(edl.includes('00:00:00:00 00:00:00:06 00:00:00:12 00:00:00:18'), 'edl: a quarter-second clip is 6 frames and follows at frame 12');
}
{
  const edl = X.buildEDL([clip(1, 4, { edit: { trimIn: 0.5, trimOut: 3.5 } })], 24);
  ok(edl.includes('00:00:00:00 00:00:03:00 00:00:00:00 00:00:03:00'), 'edl: a sub-second trim pair survives (3.0s, not 3 rounded from 2.99)');
}

/* the same cut at 30 reads the same wall clock with different frame fields */
{
  const at24 = X.buildEDL([clip(1, 3600)], 24);
  const at30 = X.buildEDL([clip(1, 3600)], 30);
  ok(at30.includes('* FRAME RATE: 30') && at30.includes('01:00:00:00'), 'edl: one hour is one hour at 30 too');
  ok(at24 !== at30, 'edl: the rate changes the file, so it cannot be left implicit');
  const at30odd = X.buildEDL([clip(1, 1 / 30)], 30);
  ok(at30odd.includes('00:00:00:00 00:00:00:01'), 'edl: one frame at 30 is one frame');
}

/* a zero-length clip cannot become a zero-length event: record in === record
   out is an event no conform will accept. */
{
  const edl = X.buildEDL([clip(1, 0)], 24);
  ok(edl.includes('00:00:00:00 00:00:00:01 00:00:00:00 00:00:00:01'), 'edl: a zero-length clip is floored to one frame, never in===out');
}

/* record timecodes are contiguous across a long, irregular cut */
{
  const durs = [3.5, 900, 0.25, 2700, 12.75, 61];
  const edl = X.buildEDL(durs.map((d, i) => clip(i + 1, d)), 24);
  const recIns = [...edl.matchAll(/^\d{3}\s+\S+\s+V\s+C\s+\S+ \S+ (\S+) (\S+)$/gm)].map((m) => [m[1], m[2]]);
  const toF = (t) => { const p = t.split(':').map(Number); return ((p[0] * 60 + p[1]) * 60 + p[2]) * 24 + p[3]; };
  let contiguous = recIns.length === durs.length;
  for (let i = 1; i < recIns.length; i++) if (toF(recIns[i][0]) !== toF(recIns[i - 1][1])) contiguous = false;
  ok(contiguous, 'edl: every event starts exactly where the previous one ended');
  const total = durs.reduce((a, d) => a + Math.max(1, Math.round(d * 24)), 0);
  ok(recIns.length && toF(recIns[recIns.length - 1][1]) === total, 'edl: the last record-out is the sum of the events');
  ok(toF(recIns[recIns.length - 1][1]) > 24 * 3600, 'edl: this fixture really is longer than an hour');
}

/* comment lines carry what a conform operator needs */
{
  const edl = X.buildEDL([clip(1, 4, { videoUrl: 'reel1.mp4', description: 'A rusted truck rattles past.', edit: { transition: 'dissolve' } })], 24);
  ok(edl.includes('* FROM CLIP NAME: CLIP_01'), 'edl: from-clip-name comment');
  ok(edl.includes('* SOURCE FILE: reel1.mp4'), 'edl: source file comment');
  ok(edl.includes('* TRANSITION: dissolve'), 'edl: non-cut transitions are noted');
  ok(!/shotbreak/i.test(edl), 'edl: brand clean');
}

/* ── exportEDL delivers exactly what buildEDL produced ── */
{
  downloads.length = 0;
  const returned = X.exportEDL([clip(1, 3600)], 24);
  ok(downloads.length === 1 && downloads[0].name === 'cinamate-timeline.edl', 'exportEDL: downloads one .edl');
  eq(downloads[0].blob.text(), returned, 'exportEDL: the bytes handed to the browser are the EDL text');
  ok(downloads[0].blob.text().includes('01:00:00:00'), 'exportEDL: the delivered file carries the corrected hour');
}

/* ── exportProject writes the frame rate down ── */
{
  downloads.length = 0;
  const out = X.exportProject({ projectName: 'Ninety Minutes', clips: [{ num: 1 }] });
  eq(out.fps, 24, 'exportProject: stamps a default rate rather than leaving it absent');
  eq(X.exportProject({ clips: [] }, 30).fps, 30, 'exportProject: an explicit rate wins');
  eq(X.exportProject({ clips: [], fps: 25 }).fps, 25, 'exportProject: a rate already on the state is kept');
  const written = JSON.parse(downloads[0].blob.text());
  ok(written.fps === 24 && written.projectName === 'Ninety Minutes', 'exportProject: the downloaded JSON carries fps beside the state');
  ok(downloads[0].name === 'cinamate-timeline-project.json', 'exportProject: filename');
}

/* ── renderQueue: the one piece of HTML this module writes ── */
{
  const html = X.renderQueue([
    { id: 'a', num: 1, label: '<img src=x onerror=alert(1)>', status: 'generating' },
    { id: 'b', num: 2, label: 'Chase', videoUrl: 'x.mp4', status: 'done', error: '' },
  ], { running: false });
  ok(!html.includes('<img src=x'), 'renderQueue: a clip label is escaped, not injected');
  ok(html.includes('&lt;img'), 'renderQueue: escaped form is present');
  ok(html.includes('st-running') && html.includes('st-done'), 'renderQueue: status classes');
  ok(X.renderQueue([], null).includes('No clips in queue'), 'renderQueue: empty state');
  ok(X.renderQueue([], { running: true }).includes('Batch job'), 'renderQueue: a running batch shows even with no clips');
}

/* ── the Master frame rate must actually REACH the exporter ───────────
   buildEDL/exportEDL/exportProject all take an fps argument and always
   honoured it. The defect was one level up: timeline/timeline.js called them
   with NO rate, nothing read the #tlFps picker, and state.fps was set to 24
   and never read again — so normFps() substituted the default and every export
   said `* FRAME RATE: 24` however the picker was set. A 25 or 29.97 master
   conformed a frame adrift per second, and the file gave no hint.

   The file's own header comment described the hazard precisely ("that is how a
   30 fps master ships with 24 fps timecode") and asserted the rate WAS threaded
   to every export call. A comment is not a wire. So this checks the WIRING, by
   source — the exporter assertions above could never have caught it, because
   the exporter was never wrong. */
{
  const page = readFileSync(join(ROOT, 'timeline/timeline.js'), 'utf8');
  const html = readFileSync(join(ROOT, 'timeline/index.html'), 'utf8');

  ok(/id="tlFps"/.test(html), 'the Master frame rate picker exists in the page');
  ok(/\$\('tlFps'\)/.test(page), 'something actually READS the picker');

  const edlCall = /SBExport\.exportEDL\(([^;]*)\)/.exec(page);
  ok(!!edlCall && edlCall[1].includes(','),
    'exportEDL is called with a second argument (the rate)');
  const projCall = /SBExport\.exportProject\(([\s\S]*?)\);/.exec(page);
  ok(!!projCall && /\},\s*\w+/.test(projCall[1]),
    'exportProject is called with a second argument (the rate)');

  /* And the exporter half, so the pairing is pinned end to end. */
  const at25 = X.buildEDL([{ num: 1, durationSec: 1, label: 'A' }], 25);
  const at24 = X.buildEDL([{ num: 1, durationSec: 1, label: 'A' }], 24);
  const at2997 = X.buildEDL([{ num: 1, durationSec: 1, label: 'A' }], 29.97);
  const atJunk = X.buildEDL([{ num: 1, durationSec: 1, label: 'A' }], 'not a rate');
  ok(/FRAME RATE: 25/.test(at25), 'a 25 fps export prints 25');
  /* 29.97 is stamped as 30, and that is CORRECT, not a rounding bug: non-drop
     timecode counts whole frames, so buildEDL takes Math.round(normFps(fps))
     deliberately (see the comment at timeline-export.js:19) and FCM carries the
     drop/non-drop distinction instead. I asserted 29.97 here first and was
     wrong about the format, not the code. What matters is that a 29.97 master
     is NOT silently stamped 24. */
  ok(/FRAME RATE: 30/.test(at2997), 'a 29.97 fps master stamps 30, the integer non-drop rate');
  ok(!/FRAME RATE: 24/.test(at2997), 'a 29.97 master is never stamped with the 24 fps default');
  const at23976 = X.buildEDL([{ num: 1, durationSec: 1, label: 'A' }], 23.976);
  ok(/FRAME RATE: 24/.test(at23976), 'a 23.976 master stamps 24, likewise by convention');
  ok(/FRAME RATE: 24/.test(atJunk),
    'an unreadable rate falls back to the default rather than NaN');
  /* Counter-assertion: 25 and 24 must actually DIFFER, or the checks above
     would pass on an exporter that ignored its argument entirely. */
  ok(at25 !== at24, 'the rate changes the output, not just the header line');
}

if (failed) { console.error('\nTimeline export checks FAILED'); process.exit(1); }

console.log('\nAll timeline export checks passed.');
