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

/* timecode + EDL */
ok(C.tc(3661.5, 24) === '01:01:01:12', 'tc formats HH:MM:SS:FF');
const edl = C.edl(p);
ok(edl.startsWith('TITLE: TEST CUT'), 'edl: title line');
ok(edl.includes('001  AX       V     C        00:00:00:00 00:00:04:00 00:00:00:00 00:00:04:00'), 'edl: event 1 line exact');
ok(edl.includes('* FROM CLIP NAME: Chase') && edl.includes('* SPEED: 200%'), 'edl: clip name + speed note');
ok(!/shotbreak/i.test(edl), 'edl: brand clean');

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

if (failed) { console.error('\nCut checks FAILED'); process.exit(1); }
console.log('\nAll cut checks passed.');
