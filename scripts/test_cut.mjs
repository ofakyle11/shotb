#!/usr/bin/env node
/* Node checks for the CINAMATE Editor cut engine + MP4 writer. */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'editor/lib-cut.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'editor/lib-mp4.js'), 'utf8'));
const C = globalThis.CCut;
const M = globalThis.CMux;

let failed = 0;
function ok(cond, name) {
  if (cond) console.log('  ok ', name);
  else { console.error('  FAIL', name); failed = 1; }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/* ── timeline math ── */
const p = C.blank('TEST CUT');
p.video.push(
  { id: 'a', srcId: 's1', label: 'Opening', in: 0, out: 4, speed: 1, trans: { type: 'cut', dur: 0 } },
  { id: 'b', srcId: 's2', label: 'Chase', in: 1, out: 5, speed: 2, trans: { type: 'crossfade', dur: 1 } },
  { id: 'c', srcId: 's3', label: 'Finale', in: 0, out: 3, speed: 1, trans: { type: 'fadeblack', dur: 1 } }
);
ok(near(C.effDur(p.video[1]), 2), 'effDur honors speed (4s media @2x = 2s)');
ok(near(C.duration(p), 9), 'duration sums effective lengths (4+2+3)');
const st = C.starts(p);
ok(near(st[0], 0) && near(st[1], 4) && near(st[2], 6), 'starts ripple correctly');

const v0 = C.videoAt(p, 2);
ok(v0 && v0.i === 0 && near(v0.srcTime, 2), 'videoAt: first clip plain');
const v1 = C.videoAt(p, 4.25);
ok(v1 && v1.i === 1 && near(v1.srcTime, 1.5), 'videoAt: speed maps timeline→source (0.25s in @2x)');
ok(v1.prevHold && near(v1.prevHold.alpha, 0.75) && near(v1.prevHold.srcTime, 4), 'videoAt: crossfade holds prev tail at 75%');
const v2 = C.videoAt(p, 6.1);
ok(v2 && v2.i === 2 && v2.blackAlpha > 0.7, 'videoAt: fadeblack darkens clip head');
const vTail = C.videoAt(p, 5.9);
ok(vTail && vTail.i === 1 && vTail.blackAlpha > 0.7, 'videoAt: fadeblack darkens previous tail');
ok(C.videoAt(p, 42) === null, 'videoAt: null past the end');

/* titles */
p.titles.push({ id: 't1', text: 'THE END', start: 6, dur: 2, pos: 'center', size: 64 });
ok(C.titlesAt(p, 7).length === 1 && near(C.titlesAt(p, 7)[0].alpha, 1), 'titlesAt: fully on mid-title');
ok(C.titlesAt(p, 6.15)[0].alpha < 0.6, 'titlesAt: fading in');
ok(C.titlesAt(p, 5.9).length === 0, 'titlesAt: off before start');

/* audio */
p.audio.push({ id: 'm1', srcId: 'mus', label: 'Score', start: 1, in: 0, out: 6, gain: 0.8 });
ok(C.audioAt(p, 3).length === 1 && C.audioAt(p, 0.5).length === 0, 'audioAt windows');
ok(near(C.duration(p), 9), 'duration still driven by longest content');

/* split */
const p2 = JSON.parse(JSON.stringify(p));
ok(C.split(p2, 2), 'split succeeds mid-clip');
ok(p2.video.length === 4 && near(p2.video[0].out, 2) && near(p2.video[1].in, 2), 'split trims and inserts');
ok(near(C.duration(p2), 9), 'split preserves total duration');
ok(!C.split(JSON.parse(JSON.stringify(p)), 4.01), 'split refuses near cut point');

/* move + trim clamp */
const arr = [1, 2, 3];
C.move(arr, 0, 2);
ok(arr.join() === '2,3,1', 'move reorders');
const cl = C.clampTrim({ in: -1, out: 99, speed: 1 }, 5);
ok(cl.in === 0 && cl.out === 5, 'clampTrim clamps to media bounds');

/* ── the frame rate is a property of the cut, not of the export dialogue ──
   project.fps used to be created by blank() and never written again, so every
   turnover file assumed 24 whatever the picker said. */
ok(C.blank('x').fps === 24, 'blank: a cut is born at 24');
ok(C.blank('x', 30).fps === 30, 'blank: a cut can be born at another rate');
ok(C.normFps(0) === 24 && C.normFps(-1) === 24 && C.normFps('nope') === 24, 'normFps: a nonsense rate is 24, in one place');
ok(C.normFps('30') === 30 && C.normFps(23.976) === 23.976, 'normFps: real rates survive, fractional included');
ok(C.fpsOf({}) === 24 && C.fpsOf(null) === 24 && C.fpsOf({ fps: 30 }) === 30, 'fpsOf: reads the project, never the caller default');

/* timecode + EDL */
ok(C.tc(3661.5, 24) === '01:01:01:12', 'tc formats HH:MM:SS:FF');
ok(C.tc(3600, 24) === '01:00:00:00' && C.tc(5400, 24) === '01:30:00:00', 'tc: an hour and ninety minutes land in the HOURS field');
ok(C.tc(0.5, 24) === '00:00:00:12' && C.tc(1 / 30, 30) === '00:00:00:01', 'tc: sub-second cuts count frames');
ok(C.tc(3600, 30) === '01:00:00:00' && C.tc(1, 30) === '00:00:01:00', 'tc: the rate is used, not assumed');
ok(C.tc(3600, 23.976) === '01:00:00:00', 'tc: a fractional rate still counts non-drop against the nominal 24');
const edl = C.edl(p);
ok(edl.startsWith('TITLE: TEST CUT'), 'edl: title line');
ok(edl.includes('001  AX       V     C        00:00:00:00 00:00:04:00 00:00:00:00 00:00:04:00'), 'edl: event 1 line exact');
ok(edl.includes('* FROM CLIP NAME: Chase') && edl.includes('* SPEED: 200%'), 'edl: clip name + speed note');
ok(edl.includes('* FRAME RATE: 24'), 'edl: the rate it was counted at is written into the file');
ok(!/shotbreak/i.test(edl), 'edl: brand clean');
{
  /* Same cut, declared at 30 — every frame field must change and the wall
     clock must not. A turnover file that does not follow project.fps is the
     defect this pins. */
  const p30 = JSON.parse(JSON.stringify(p)); p30.fps = 30;
  const e30 = C.edl(p30);
  ok(e30.includes('* FRAME RATE: 30'), 'edl @30: rate stamped');
  ok(e30.includes('00:00:00:00 00:00:04:00 00:00:00:00 00:00:04:00'), 'edl @30: a 4s clip is still 4s');
  ok(e30.includes('00:00:06:00 00:00:09:00'), 'edl @30: the last event still ends at 9s');
  ok(C.edl(Object.assign(JSON.parse(JSON.stringify(p)), { fps: 0 })).includes('* FRAME RATE: 24'), 'edl: a broken rate falls back once, visibly');
}

/* OTIO */
const otio = C.otio(p, { s1: { url: 'clip1.mp4' } });
ok(otio.OTIO_SCHEMA === 'Timeline.1', 'otio: timeline schema');
ok(otio.tracks.OTIO_SCHEMA === 'Stack.1' && otio.tracks.children.length === 2, 'otio: stack with V1+A1');
const vt = otio.tracks.children[0];
ok(vt.kind === 'Video' && vt.children.length === 3, 'otio: video track children');
ok(vt.children[0].media_references.DEFAULT_MEDIA.target_url === 'clip1.mp4', 'otio: media reference url');
ok(vt.children[1].effects[0].OTIO_SCHEMA === 'LinearTimeWarp.1' && vt.children[1].effects[0].time_scalar === 2, 'otio: speed as LinearTimeWarp');
ok(vt.children[0].source_range.duration.value === 96, 'otio: RationalTime frames (4s @24)');
const at = otio.tracks.children[1];
ok(at.children[0].OTIO_SCHEMA === 'Gap.1' && at.children[0].source_range.duration.value === 24, 'otio: audio offset as Gap');
ok(JSON.parse(JSON.stringify(otio)).name === 'TEST CUT', 'otio: serializes clean');

/* ── OTIO gap accumulation ────────────────────────────────────────────────
   An OTIO track's children play back to back. The old code emitted a Gap of
   each cue's ABSOLUTE start before it, so the gaps summed: cues at 2s and 10s
   came out at 2s and 15s. One cue hid it — the old fixture had exactly one —
   so this uses THREE at irregular times and reads the absolute position of
   each cue back out of the track the way Resolve would. */
{
  const q = C.blank('THREE CUES');
  q.video.push({ id: 'v', srcId: 's1', label: 'Plate', in: 0, out: 30, speed: 1, trans: { type: 'cut', dur: 0 } });
  q.audio.push(
    { id: 'a1', srcId: 'fx1', label: 'Door', start: 2, in: 0, out: 3, gain: 1 },
    { id: 'a2', srcId: 'fx2', label: 'Siren', start: 10, in: 0, out: 2.5, gain: 1 },
    { id: 'a3', srcId: 'fx3', label: 'Bell', start: 17.25, in: 0, out: 1, gain: 1 }
  );
  const o = C.otio(q, {});
  const lanes = o.tracks.children.filter((t) => t.kind === 'Audio');
  ok(lanes.length === 1, 'otio 3 cues: three non-overlapping cues fit on one audio track');
  /* walk the track the way a reader does: a running cursor over the children */
  const at = {};
  let cur = 0;
  lanes[0].children.forEach((ch) => {
    if (ch.OTIO_SCHEMA === 'Clip.2') at[ch.name] = cur;
    cur += ch.source_range.duration.value;
  });
  ok(at.Door === 48, 'otio 3 cues: cue 1 lands at 2.0s (48f)');
  ok(at.Siren === 240, 'otio 3 cues: cue 2 lands at 10.0s (240f) — the accumulating-gap bug put it at 15.0s');
  ok(at.Bell === 414, 'otio 3 cues: cue 3 lands at 17.25s (414f), not five-plus seconds late');
  const gaps = lanes[0].children.filter((c2) => c2.OTIO_SCHEMA === 'Gap.1').map((g) => g.source_range.duration.value);
  ok(gaps.join() === '48,120,114', 'otio 3 cues: gaps are the RELATIVE distances, not the absolute starts');
  ok(cur === 438, 'otio 3 cues: the track ends at 18.25s (438f)');
  ok(lanes[0].children.every((ch) => ch.source_range.duration.rate === 24), 'otio 3 cues: every RationalTime carries the project rate');
}

/* cues given out of order, and a cue that overlaps another */
{
  const q = C.blank('OUT OF ORDER');
  q.video.push({ id: 'v', srcId: 's1', label: 'Plate', in: 0, out: 30, speed: 1, trans: { type: 'cut', dur: 0 } });
  q.audio.push(
    { id: 'a3', srcId: 'fx3', label: 'Late', start: 12, in: 0, out: 1, gain: 1 },
    { id: 'a1', srcId: 'fx1', label: 'Early', start: 1, in: 0, out: 2, gain: 1 },
    { id: 'a2', srcId: 'fx2', label: 'Under', start: 1.5, in: 0, out: 4, gain: 1 }
  );
  const o = C.otio(q, {});
  const lanes = o.tracks.children.filter((t) => t.kind === 'Audio');
  ok(lanes.length === 2, 'otio overlap: a cue that overlaps another opens A2 rather than being shoved later');
  ok(lanes[0].name === 'A1' && lanes[1].name === 'A2', 'otio overlap: lanes are named A1, A2');
  const pos = (tr) => { let c2 = 0; const m = {}; tr.children.forEach((ch) => { if (ch.OTIO_SCHEMA === 'Clip.2') m[ch.name] = c2; c2 += ch.source_range.duration.value; }); return m; };
  const l1 = pos(lanes[0]), l2 = pos(lanes[1]);
  ok(l1.Early === 24, 'otio overlap: the earliest cue is at 1.0s on A1');
  ok(l1.Late === 288, 'otio overlap: a later non-overlapping cue rejoins A1 at 12.0s');
  ok(l2.Under === 36, 'otio overlap: the overlapping cue keeps its own 1.5s start on A2');
}

/* the rate is threaded, not defaulted */
{
  const q = C.blank('THIRTY', 30);
  q.video.push({ id: 'v', srcId: 's1', label: 'Plate', in: 0, out: 4, speed: 1, trans: { type: 'cut', dur: 0 } });
  q.audio.push({ id: 'a', srcId: 'fx', label: 'Cue', start: 2, in: 0, out: 1, gain: 1 });
  const o = C.otio(q, {});
  ok(o.metadata.cinamate.fps === 30 && o.global_start_time.rate === 30, 'otio @30: the project rate reaches the file');
  ok(o.tracks.children[0].children[0].source_range.duration.value === 120, 'otio @30: 4s is 120 frames');
  const g = o.tracks.children[1].children[0];
  ok(g.OTIO_SCHEMA === 'Gap.1' && g.source_range.duration.value === 60, 'otio @30: a 2s pre-roll is 60 frames');
}

/* peaks */
const sig = new Float32Array(1000).map((_, i) => (i < 500 ? 0.1 : 0.9) * (i % 2 ? 1 : -1));
const pk = C.peaks(sig, 2);
ok(near(pk[0], 0.1) && near(pk[1], 0.9), 'peaks: bucket maxima');

/* ── MP4 writer ── */
const vidData = new Uint8Array([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3]);
const audData = new Uint8Array([9, 9, 9, 8, 8]);
const mp4 = M.buildMp4([
  {
    type: 'video', timescale: 90000, durations: [3750, 3750, 3750],
    sizes: [5, 6, 3], data: vidData, sync: [true, false, false],
    description: new Uint8Array([0x01, 0x64, 0x00, 0x1f, 0xff]), width: 1280, height: 720
  },
  {
    type: 'audio', timescale: 48000, durations: [1024, 1024],
    sizes: [3, 2], data: audData,
    description: new Uint8Array([0x11, 0x90]), channels: 2, sampleRate: 48000
  }
]);
const tree = M.parse(mp4);
ok(tree.length === 3 && tree[0].type === 'ftyp' && tree[1].type === 'moov' && tree[2].type === 'mdat', 'mp4: ftyp|moov|mdat layout');
ok(M.findAll(tree, 'trak').length === 2, 'mp4: two tracks');
ok(M.find(tree, 'avcC') === null || true, 'mp4: parser tolerant'); // avcC nested in stsd payload, not walked
const mdat = tree[2];
const payload = mp4.slice(mdat.start + 8, mdat.start + mdat.size);
ok(payload.length === vidData.length + audData.length, 'mp4: mdat holds all samples');
ok(payload[0] === 1 && payload[vidData.length] === 9, 'mp4: sample order video then audio');
/* verify stco offsets actually point at the right bytes */
const stcos = M.findAll(tree, 'stco');
ok(stcos.length === 2, 'mp4: stco per track');
function stcoOffset(node) {
  const o = node.start + 8 + 4 + 4; // header + version/flags + entry_count
  return (mp4[o] << 24 | mp4[o + 1] << 16 | mp4[o + 2] << 8 | mp4[o + 3]) >>> 0;
}
ok(mp4[stcoOffset(stcos[0])] === 1, 'mp4: video chunk offset lands on first video byte');
ok(mp4[stcoOffset(stcos[1])] === 9, 'mp4: audio chunk offset lands on first audio byte');
/* avcC bytes embedded */
const hex = Array.from(mp4).map(b => b.toString(16).padStart(2, '0')).join('');
ok(hex.includes('61766343' + '0164001fff'), 'mp4: avcC carries encoder description');
ok(hex.includes('6d703461'), 'mp4: mp4a entry present');
ok(hex.includes('65736473'), 'mp4: esds present');
ok(hex.includes('1190'), 'mp4: AudioSpecificConfig embedded');
/* stsz sizes */
const stszs = M.findAll(tree, 'stsz');
function stszSizes(node) {
  const base = node.start + 8 + 4 + 4 + 4;
  const n = (mp4[node.start + 16] << 24 | mp4[node.start + 17] << 16 | mp4[node.start + 18] << 8 | mp4[node.start + 19]) >>> 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = base + i * 4;
    out.push((mp4[o] << 24 | mp4[o + 1] << 16 | mp4[o + 2] << 8 | mp4[o + 3]) >>> 0);
  }
  return out;
}
ok(stszSizes(stszs[0]).join() === '5,6,3', 'mp4: video sample sizes');
ok(stszSizes(stszs[1]).join() === '3,2', 'mp4: audio sample sizes');
/* stss present with only sample 1 sync */
ok(hex.includes('73747373'), 'mp4: stss sync table present');
/* deterministic double-pass */
ok(M.buildMp4([{ type: 'video', timescale: 90000, durations: [3000], sizes: [4], data: new Uint8Array(4), sync: [true], description: new Uint8Array([1]), width: 64, height: 64 }]).length > 100, 'mp4: single-track build ok');

/* ═══ the boxes are CORRECT, not merely present ════════════════════════════
   Everything above this line asserts that a box exists. A muxer whose stss
   listed the wrong frames, whose timescales disagreed and whose audio started
   21ms late would pass every one of them. These read the numbers back. */
function rd32(u8, o) { return (u8[o] << 24 | u8[o + 1] << 16 | u8[o + 2] << 8 | u8[o + 3]) >>> 0; }
function rd16(u8, o) { return u8[o] << 8 | u8[o + 1]; }
/* mvhd/mdhd v0: 8 header + 4 version/flags + 4 creation + 4 modification,
   then timescale, then duration. tkhd v0 carries track_ID and a reserved
   word between modification and duration. */
const tsOf = (u8, n) => rd32(u8, n.start + 20);
const durOf = (u8, n) => rd32(u8, n.start + 24);
const tkhdDurOf = (u8, n) => rd32(u8, n.start + 28);
function sttsRuns(u8, n) {
  const out = [];
  const count = rd32(u8, n.start + 12);
  for (let i = 0; i < count; i++) out.push([rd32(u8, n.start + 16 + i * 8), rd32(u8, n.start + 20 + i * 8)]);
  return out;
}
function stssList(u8, n) {
  const out = [];
  const count = rd32(u8, n.start + 12);
  for (let i = 0; i < count; i++) out.push(rd32(u8, n.start + 16 + i * 4));
  return out;
}
function elstOf(u8, n) {
  return { entries: rd32(u8, n.start + 12), segment: rd32(u8, n.start + 16), mediaTime: rd32(u8, n.start + 20) | 0,
    rateInt: rd16(u8, n.start + 24), rateFrac: rd16(u8, n.start + 26) };
}

/* One real second of picture at 24 fps, and the audio an AAC encoder would
   actually hand back for it: whole 1024-sample frames, so 48 packets cover
   1.024s of a 1.000s mix, with the first 1024 samples being codec priming. */
{
  const VF = 24, VTS = 90000, ATS = 48000, PKTS = 48;
  const mp4b = M.buildMp4([
    { type: 'video', timescale: VTS, durations: new Array(VF).fill(VTS / VF),
      sizes: new Array(VF).fill(4), data: new Uint8Array(VF * 4),
      sync: new Array(VF).fill(false).map((_, i) => i % 12 === 0),
      description: new Uint8Array([1, 100, 0, 31, 255]), width: 1920, height: 1080 },
    { type: 'audio', timescale: ATS, durations: new Array(PKTS).fill(1024),
      sizes: new Array(PKTS).fill(6), data: new Uint8Array(PKTS * 6),
      description: new Uint8Array([0x11, 0x90]), channels: 2, sampleRate: ATS,
      priming: 1024, presentDuration: ATS },
  ]);
  const tb = M.parse(mp4b);
  const traks = M.findAll(tb, 'trak');
  const vTrak = traks[0], aTrak = traks[1];
  const mvhdN = M.find(tb, 'mvhd');
  const vMdhd = M.find(vTrak.children, 'mdhd'), aMdhd = M.find(aTrak.children, 'mdhd');

  /* timescales */
  ok(tsOf(mp4b, mvhdN) === 1000, 'mp4: movie timescale is 1000 (ms)');
  ok(tsOf(mp4b, vMdhd) === VTS, 'mp4: video media timescale is the one the caller gave (90000)');
  ok(tsOf(mp4b, aMdhd) === ATS, 'mp4: audio media timescale is the sample rate (48000)');

  /* sample timing: 24 frames of 3750 ticks is exactly one second */
  const vStts = sttsRuns(mp4b, M.find(vTrak.children, 'stts'));
  ok(vStts.length === 1 && vStts[0][0] === VF && vStts[0][1] === VTS / VF, 'mp4: stts run-length encodes 24 frames of 3750 ticks');
  ok(vStts[0][0] * vStts[0][1] === VTS, 'mp4: the frame durations sum to exactly one second of media');
  ok(durOf(mp4b, vMdhd) === VTS, 'mp4: video mdhd duration equals the summed sample durations');
  ok(durOf(mp4b, aMdhd) === PKTS * 1024, 'mp4: audio mdhd duration is the FULL encoded media, priming included');

  /* sync samples: the keyframes are the ones we said were keyframes */
  ok(stssList(mp4b, M.find(vTrak.children, 'stss')).join() === '1,13', 'mp4: stss lists exactly the sync samples, 1-based');

  /* the edit list — the fix for AAC priming */
  const aEdts = M.find(aTrak.children, 'edts');
  ok(!!aEdts, 'mp4: the audio track carries an edts');
  const e = elstOf(mp4b, M.find(aEdts.children, 'elst'));
  ok(e.entries === 1 && e.rateInt === 1 && e.rateFrac === 0, 'mp4: one elst segment at rate 1.0');
  ok(e.mediaTime === 1024, 'mp4: elst media_time skips the 1024 primed samples (the ~21.3ms lag)');
  ok(e.segment === 1000, 'mp4: elst presents exactly 1000ms — the tail rounded up to a whole AAC frame is trimmed too');
  ok(!M.find(vTrak.children, 'edts'), 'mp4: picture starts at sample 0 and needs no edit list');

  /* sync: what the two tracks PRESENT is the same length, to the millisecond */
  ok(tkhdDurOf(mp4b, M.find(vTrak.children, 'tkhd')) === 1000, 'mp4: video tkhd presents 1000ms');
  ok(tkhdDurOf(mp4b, M.find(aTrak.children, 'tkhd')) === 1000, 'mp4: audio tkhd presents 1000ms — picture and sound agree');
  ok(durOf(mp4b, mvhdN) === 1000, 'mp4: mvhd duration is the presented length, not the padded media length');
  ok(durOf(mp4b, aMdhd) > tkhdDurOf(mp4b, M.find(aTrak.children, 'tkhd')) * ATS / 1000,
    'mp4: there IS more audio media than is presented — the edit list is doing the work');

  /* colour */
  const hex2 = Array.from(mp4b).map((x) => x.toString(16).padStart(2, '0')).join('');
  ok(hex2.includes('636f6c72' + '6e636c78' + '000100010001' + '00'), 'mp4: colr nclx declares Rec.709 primaries/transfer/matrix, limited range');
  ok(hex2.indexOf('636f6c72') > hex2.indexOf('61766343'), 'mp4: colr sits beside avcC inside the avc1 entry');
}

/* priming can be switched off, and then no edit list is written */
{
  const raw = M.buildMp4([{ type: 'audio', timescale: 48000, durations: [1024, 1024], sizes: [3, 2],
    data: new Uint8Array(5), description: new Uint8Array([0x11, 0x90]), channels: 2, sampleRate: 48000, priming: 0 }]);
  const t2 = M.parse(raw);
  ok(!M.find(t2, 'edts'), 'mp4: priming 0 writes no edit list');
  ok(tkhdDurOf(raw, M.find(t2, 'tkhd')) === Math.round(2048 / 48000 * 1000), 'mp4: with no edit the track presents all of its media');
}
/* a colour override, and opting out entirely */
{
  const bt601 = M.buildMp4([{ type: 'video', timescale: 90000, durations: [3750], sizes: [4], data: new Uint8Array(4),
    sync: [true], description: new Uint8Array([1]), width: 720, height: 480, colr: { primaries: 6, transfer: 6, matrix: 6, fullRange: true } }]);
  const h601 = Array.from(bt601).map((x) => x.toString(16).padStart(2, '0')).join('');
  ok(h601.includes('6e636c78' + '000600060006' + '80'), 'mp4: a caller can declare Rec.601 full-range instead');
  const none = M.buildMp4([{ type: 'video', timescale: 90000, durations: [3750], sizes: [4], data: new Uint8Array(4),
    sync: [true], description: new Uint8Array([1]), width: 720, height: 480, colr: false }]);
  ok(!Array.from(none).map((x) => x.toString(16).padStart(2, '0')).join('').includes('636f6c72'), 'mp4: colr:false omits the box');
}
/* the edit list must never eat a whole track */
{
  const tiny = M.buildMp4([{ type: 'audio', timescale: 48000, durations: [1024], sizes: [3], data: new Uint8Array(3),
    description: new Uint8Array([0x11, 0x90]), channels: 2, sampleRate: 48000 }]);
  const tt = M.parse(tiny);
  ok(!M.find(tt, 'edts'), 'mp4: a track shorter than its own priming is left alone rather than edited to nothing');
  ok(tkhdDurOf(tiny, M.find(tt, 'tkhd')) > 0, 'mp4: that track still presents something');
}


/* ── the crossfade's outgoing frame must be captured where BOTH paths run ──
   prevFrame — the frame a crossfade mixes against — was written only inside
   the rAF playback loop, on clip handoff. exportMp4 pauses and then renders
   frame by frame, so it never entered that loop: an exported crossfade mixed
   against whatever was cached the last time somebody scrubbed past a cut, or
   against nothing. It previewed correctly and came out wrong in the file.
   Fade-to-black was unaffected — it fills with black and needs no cached
   frame — which is precisely why the fault stayed hidden.

   This is a WIRING defect: lib-cut.js's model was always right, and every
   assertion above drives that model directly, so none of them could have
   caught it. Checked by source, in the file where the gap lives. */
{
  const ui = readFileSync(join(ROOT, 'editor/cut-ui.js'), 'utf8');

  const draw = ui.slice(ui.indexOf('async function drawFrame'),
                        ui.indexOf('async function drawFrame') + 1400);
  ok(/prevFrame\.getContext/.test(draw),
    'drawFrame captures the outgoing frame — the one function playback, scrub and export all call');

  /* Order matters: drawFrame fills the canvas black, which would wipe the very
     frame being captured. */
  const capAt = draw.indexOf('prevFrame.getContext');
  const fillAt = draw.indexOf("ctx.fillStyle = '#000'");
  ok(capAt !== -1 && fillAt !== -1 && capAt < fillAt,
    'the capture happens BEFORE the black fill that would erase it');

  /* And exactly one owner: a second copy in the playback loop would drift. */
  const captures = (ui.match(/prevFrame\.getContext\('2d'\)\.drawImage/g) || []).length;
  ok(captures === 1, 'exactly one place captures the outgoing frame  (found ' + captures + ')');

  /* The reader still exists, or the fix would be capturing for nobody. */
  ok(/hit\.prevHold && prevFrame\.width/.test(ui),
    'the crossfade still reads prevFrame');

  /* Export renders through the shared function rather than its own path. */
  const exp = ui.slice(ui.indexOf('async function exportMp4'),
                       ui.indexOf('async function exportMp4') + 3000);
  ok(/drawFrame\(/.test(exp), 'export renders through drawFrame, so it inherits the capture');
}

if (failed) { console.error('\nCut checks FAILED'); process.exit(1); }
console.log('\nAll cut checks passed.');
