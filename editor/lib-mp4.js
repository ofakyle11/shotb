/* CINAMATE Editor — original MP4 (ISO base media file format) writer.
 *
 * Assembles a playable .mp4 from encoded samples produced by the
 * browser's WebCodecs encoders: an H.264 video track (avc1 + avcC from
 * the encoder's decoderConfig.description) and an optional AAC audio
 * track (mp4a + esds carrying the AudioSpecificConfig).
 *
 * Written for Cinamate from the published ISO/IEC 14496-12 box layout
 * and 14496-1 descriptor structure. Single-chunk-per-track layout:
 * ftyp | moov | mdat, with chunk offsets computed in a second pass.
 * Also includes a small box parser used by the test suite.
 */
(function (root) {
  'use strict';

  /* ── byte building ──────────────────────────────────────────────── */
  function bytes() { return { parts: [], len: 0 }; }
  function push(b, arr) { var u = arr instanceof Uint8Array ? arr : new Uint8Array(arr); b.parts.push(u); b.len += u.length; }
  function u32(n) { return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]; }
  function u16(n) { return [n >>> 8 & 255, n & 255]; }
  function str(s) { var o = []; for (var i = 0; i < s.length; i++) o.push(s.charCodeAt(i) & 255); return o; }
  function concat(b) {
    var out = new Uint8Array(b.len), off = 0;
    b.parts.forEach(function (p) { out.set(p, off); off += p.length; });
    return out;
  }
  function box(type) {
    var b = bytes();
    for (var i = 1; i < arguments.length; i++) push(b, arguments[i]);
    var out = bytes();
    push(out, u32(b.len + 8));
    push(out, str(type));
    push(out, concat(b));
    return concat(out);
  }
  function full(type, version, flags) {
    var b = bytes();
    push(b, [version, flags >>> 16 & 255, flags >>> 8 & 255, flags & 255]);
    for (var i = 3; i < arguments.length; i++) push(b, arguments[i]);
    return box(type, concat(b));
  }

  /* MPEG-4 descriptor (tag + expandable length + payload) */
  function desc(tag, payload) {
    var len = payload.length;
    var lenBytes = [];
    // 4-byte expandable form keeps this simple and legal
    lenBytes.push(0x80 | (len >>> 21 & 0x7f), 0x80 | (len >>> 14 & 0x7f), 0x80 | (len >>> 7 & 0x7f), len & 0x7f);
    var b = bytes();
    push(b, [tag]);
    push(b, lenBytes);
    push(b, payload);
    return concat(b);
  }

  /* ── shared table boxes ─────────────────────────────────────────── */
  function stts(durations) {
    // run-length encode
    var runs = [];
    durations.forEach(function (d) {
      if (runs.length && runs[runs.length - 1][1] === d) runs[runs.length - 1][0]++;
      else runs.push([1, d]);
    });
    var b = bytes();
    push(b, u32(runs.length));
    runs.forEach(function (r) { push(b, u32(r[0])); push(b, u32(r[1])); });
    return full('stts', 0, 0, concat(b));
  }
  function stsz(sizes) {
    var b = bytes();
    push(b, u32(0)); push(b, u32(sizes.length));
    sizes.forEach(function (s) { push(b, u32(s)); });
    return full('stsz', 0, 0, concat(b));
  }
  function stsc(sampleCount) {
    var b = bytes();
    push(b, u32(1)); push(b, u32(1)); push(b, u32(sampleCount)); push(b, u32(1));
    return full('stsc', 0, 0, concat(b));
  }
  function stco(offset) {
    var b = bytes();
    push(b, u32(1)); push(b, u32(offset));
    return full('stco', 0, 0, concat(b));
  }
  function stss(syncIndices) { // 1-based sample numbers
    var b = bytes();
    push(b, u32(syncIndices.length));
    syncIndices.forEach(function (s) { push(b, u32(s)); });
    return full('stss', 0, 0, concat(b));
  }

  function mvhd(timescale, duration, nextTrack) {
    var b = bytes();
    push(b, u32(0)); push(b, u32(0));               // times
    push(b, u32(timescale)); push(b, u32(duration));
    push(b, u32(0x00010000)); push(b, u16(0x0100)); push(b, u16(0)); // rate, volume
    push(b, new Uint8Array(8));                      // reserved
    push(b, u32(0x00010000)); push(b, u32(0)); push(b, u32(0));
    push(b, u32(0)); push(b, u32(0x00010000)); push(b, u32(0));
    push(b, u32(0)); push(b, u32(0)); push(b, u32(0x40000000)); // unity matrix
    push(b, new Uint8Array(24));                     // predefined
    push(b, u32(nextTrack));
    return full('mvhd', 0, 0, concat(b));
  }
  function tkhd(id, durationMv, width, height, isAudio) {
    var b = bytes();
    push(b, u32(0)); push(b, u32(0));
    push(b, u32(id)); push(b, u32(0)); push(b, u32(durationMv));
    push(b, new Uint8Array(8));
    push(b, u16(0)); push(b, u16(0));                       // layer, group
    push(b, u16(isAudio ? 0x0100 : 0)); push(b, u16(0));    // volume
    push(b, u32(0x00010000)); push(b, u32(0)); push(b, u32(0));
    push(b, u32(0)); push(b, u32(0x00010000)); push(b, u32(0));
    push(b, u32(0)); push(b, u32(0)); push(b, u32(0x40000000));
    push(b, u32((width || 0) << 16)); push(b, u32((height || 0) << 16));
    return full('tkhd', 0, 3, concat(b)); // enabled + in movie
  }
  function mdhd(timescale, duration) {
    var b = bytes();
    push(b, u32(0)); push(b, u32(0));
    push(b, u32(timescale)); push(b, u32(duration));
    push(b, u16(0x55c4)); push(b, u16(0)); // language 'und'
    return full('mdhd', 0, 0, concat(b));
  }
  function hdlr(kind, name) {
    var b = bytes();
    push(b, u32(0));
    push(b, str(kind));
    push(b, new Uint8Array(12));
    push(b, str(name)); push(b, [0]);
    return full('hdlr', 0, 0, concat(b));
  }
  function dinf() {
    var url = full('url ', 0, 1, []);
    var b = bytes();
    push(b, u32(1)); push(b, url);
    return box('dinf', full('dref', 0, 0, concat(b)));
  }

  /* ── sample entries ─────────────────────────────────────────────── */
  function avc1Entry(width, height, avcC) {
    var b = bytes();
    push(b, new Uint8Array(6)); push(b, u16(1));     // reserved, data_ref_index
    push(b, new Uint8Array(16));                     // predefined/reserved
    push(b, u16(width)); push(b, u16(height));
    push(b, u32(0x00480000)); push(b, u32(0x00480000)); // 72 dpi
    push(b, u32(0)); push(b, u16(1));                // frame count
    push(b, new Uint8Array(32));                     // compressor name
    push(b, u16(0x0018)); push(b, u16(0xffff));      // depth, predefined
    push(b, box('avcC', avcC));
    return box('avc1', concat(b));
  }
  function mp4aEntry(channels, sampleRate, asc) {
    var dsi = desc(0x05, asc);                                    // DecSpecificInfo
    var cfgPayload = bytes();
    push(cfgPayload, [0x40, 0x15]);                               // AAC, audio stream
    push(cfgPayload, [0, 0, 0]);                                  // buffer size
    push(cfgPayload, u32(128000)); push(cfgPayload, u32(128000)); // max/avg bitrate
    push(cfgPayload, dsi);
    var decCfg = desc(0x04, concat(cfgPayload));                  // DecoderConfig
    var sl = desc(0x06, [0x02]);                                  // SLConfig
    var esPayload = bytes();
    push(esPayload, u16(0)); push(esPayload, [0]);                // ES_ID, flags
    push(esPayload, decCfg); push(esPayload, sl);
    var esd = desc(0x03, concat(esPayload));
    var b = bytes();
    push(b, new Uint8Array(6)); push(b, u16(1));
    push(b, new Uint8Array(8));
    push(b, u16(channels)); push(b, u16(16));
    push(b, u32(0));
    push(b, u32(sampleRate << 16));
    push(b, full('esds', 0, 0, esd));
    return box('mp4a', concat(b));
  }

  /* ── track assembly ─────────────────────────────────────────────── */
  function trackBoxes(t, id, mvTimescale, chunkOffset) {
    var totalTicks = t.durations.reduce(function (a, d) { return a + d; }, 0);
    var durMv = Math.round(totalTicks / t.timescale * mvTimescale);
    var isAudio = t.type === 'audio';
    var entry = isAudio
      ? mp4aEntry(t.channels || 2, t.sampleRate || 48000, t.description || [0x11, 0x90])
      : avc1Entry(t.width || 0, t.height || 0, t.description || []);
    var stsdB = bytes();
    push(stsdB, u32(1)); push(stsdB, entry);
    var stblParts = [full('stsd', 0, 0, concat(stsdB)), stts(t.durations)];
    if (!isAudio) {
      var syncs = [];
      (t.sync || []).forEach(function (isSync, i) { if (isSync) syncs.push(i + 1); });
      if (syncs.length && syncs.length < t.sizes.length) stblParts.push(stss(syncs));
    }
    stblParts.push(stsc(t.sizes.length), stsz(t.sizes), stco(chunkOffset));
    var stbl = box.apply(null, ['stbl'].concat(stblParts));
    var minf = box('minf',
      isAudio ? full('smhd', 0, 0, u16(0).concat(u16(0))) : full('vmhd', 0, 1, u16(0).concat(u16(0), u16(0), u16(0))),
      dinf(), stbl);
    var mdia = box('mdia',
      mdhd(t.timescale, totalTicks),
      hdlr(isAudio ? 'soun' : 'vide', isAudio ? 'CinamateSound' : 'CinamateVideo'),
      minf);
    return box('trak', tkhd(id, durMv, t.width, t.height, isAudio), mdia);
  }

  /* buildMp4(tracks): tracks = [{
   *   type: 'video'|'audio', timescale, durations:[ticks per sample],
   *   sizes:[bytes], data: Uint8Array (all samples concatenated),
   *   sync:[bool] (video), description: Uint8Array (avcC / ASC),
   *   width, height | channels, sampleRate }] */
  function buildMp4(tracks) {
    var MV = 1000;
    var maxMs = 0;
    tracks.forEach(function (t) {
      var ticks = t.durations.reduce(function (a, d) { return a + d; }, 0);
      maxMs = Math.max(maxMs, Math.round(ticks / t.timescale * MV));
    });
    var ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'));

    function moovWith(offsets) {
      var parts = [mvhd(MV, maxMs, tracks.length + 1)];
      tracks.forEach(function (t, i) { parts.push(trackBoxes(t, i + 1, MV, offsets[i])); });
      return box.apply(null, ['moov'].concat(parts));
    }
    // pass 1: measure moov with placeholder offsets
    var placeholder = tracks.map(function () { return 0; });
    var moovSize = moovWith(placeholder).length;
    // mdat payload starts after ftyp + moov + mdat header (8 bytes)
    var base = ftyp.length + moovSize + 8;
    var offsets = [];
    var run = base;
    tracks.forEach(function (t) { offsets.push(run); run += t.data.length; });
    var moov = moovWith(offsets);
    if (moov.length !== moovSize) throw new Error('moov size drifted between passes');
    var payload = bytes();
    tracks.forEach(function (t) { push(payload, t.data); });
    var mdat = box('mdat', concat(payload));
    var out = bytes();
    push(out, ftyp); push(out, moov); push(out, mdat);
    return concat(out);
  }

  /* ── parser (for tests and self-checks) ─────────────────────────── */
  var CONTAINERS = { moov: 1, trak: 1, mdia: 1, minf: 1, stbl: 1, dinf: 1, edts: 1, udta: 1 };
  function parse(u8, start, end, depth) {
    start = start || 0; end = end == null ? u8.length : end; depth = depth || 0;
    var out = [];
    var pos = start;
    while (pos + 8 <= end) {
      var size = (u8[pos] << 24 | u8[pos + 1] << 16 | u8[pos + 2] << 8 | u8[pos + 3]) >>> 0;
      var type = String.fromCharCode(u8[pos + 4], u8[pos + 5], u8[pos + 6], u8[pos + 7]);
      if (size < 8 || pos + size > end) break;
      var node = { type: type, start: pos, size: size };
      if (CONTAINERS[type] && depth < 8) node.children = parse(u8, pos + 8, pos + size, depth + 1);
      out.push(node);
      pos += size;
    }
    return out;
  }
  function find(nodes, type) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].type === type) return nodes[i];
      if (nodes[i].children) {
        var hit = find(nodes[i].children, type);
        if (hit) return hit;
      }
    }
    return null;
  }
  function findAll(nodes, type, acc) {
    acc = acc || [];
    nodes.forEach(function (n) {
      if (n.type === type) acc.push(n);
      if (n.children) findAll(n.children, type, acc);
    });
    return acc;
  }

  root.CMux = { buildMp4: buildMp4, parse: parse, find: find, findAll: findAll };
})(typeof window !== 'undefined' ? window : globalThis);
