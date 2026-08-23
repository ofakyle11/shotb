/* CINAMATE Editor — cut engine (pure timeline math, no DOM).
 *
 * The project model is a ripple video track (clips butt together in
 * order), a title track and a free-positioned audio track. All original
 * code, written for Cinamate. EDL text follows the long-published CMX
 * event-line convention; OTIO output follows the documented
 * OpenTimelineIO JSON schema (Timeline.1 / Track.1 / Clip.2) that
 * DaVinci Resolve and Premiere read natively.
 */
(function (root) {
  'use strict';

  function blank(name) {
    return {
      name: name || 'Untitled Cut',
      fps: 24, width: 1280, height: 720,
      video: [],   // {id, srcId, label, in, out, speed, trans:{type,dur}}
      titles: [],  // {id, text, sub, start, dur, pos, size}
      audio: []    // {id, srcId, label, start, in, out, gain}
    };
  }

  function effDur(c) { return Math.max(0, (c.out - c.in) / (c.speed || 1)); }

  function starts(p) {
    var t = 0;
    return (p.video || []).map(function (c) { var s = t; t += effDur(c); return s; });
  }

  function duration(p) {
    var d = (p.video || []).reduce(function (a, c) { return a + effDur(c); }, 0);
    (p.titles || []).forEach(function (t) { d = Math.max(d, t.start + t.dur); });
    (p.audio || []).forEach(function (a) { d = Math.max(d, a.start + effDur(a)); });
    return d;
  }

  /* What is on screen at time t.
   * Returns null past the end, else:
   * { i, clip, srcTime, prevHold: {i, alpha} | null, blackAlpha } */
  function videoAt(p, t) {
    var st = starts(p);
    var clips = p.video || [];
    if (!clips.length) return null;
    var total = duration(p);
    if (t < 0 || t >= total && t >= st[st.length - 1] + effDur(clips[clips.length - 1])) {
      if (t < 0) return null;
    }
    var i = -1;
    for (var k = clips.length - 1; k >= 0; k--) {
      if (t >= st[k] - 1e-9) { i = k; break; }
    }
    if (i < 0) return null;
    var clip = clips[i];
    if (t > st[i] + effDur(clip) + 1e-9) return null; // beyond last clip
    var srcTime = clip.in + (t - st[i]) * (clip.speed || 1);
    srcTime = Math.min(clip.out, Math.max(clip.in, srcTime));
    var out = { i: i, clip: clip, srcTime: srcTime, prevHold: null, blackAlpha: 0 };

    var tr = clip.trans || { type: 'cut', dur: 0 };
    var into = t - st[i]; // seconds into this clip
    if (i > 0 && tr.type === 'crossfade' && tr.dur > 0 && into < tr.dur) {
      var prev = clips[i - 1];
      out.prevHold = { i: i - 1, alpha: 1 - into / tr.dur, srcTime: prev.out };
    }
    if (tr.type === 'fadeblack' && tr.dur > 0) {
      var half = tr.dur / 2;
      if (into < half) out.blackAlpha = 1 - into / half; // fade in from black
    }
    // symmetric tail: next clip's fadeblack darkens this clip's end
    if (i + 1 < clips.length) {
      var ntr = clips[i + 1].trans || {};
      if (ntr.type === 'fadeblack' && ntr.dur > 0) {
        var tail = (st[i] + effDur(clip)) - t;
        var h2 = ntr.dur / 2;
        if (tail < h2) out.blackAlpha = Math.max(out.blackAlpha, 1 - tail / h2);
      }
    }
    return out;
  }

  var TITLE_FADE = 0.3;
  function titlesAt(p, t) {
    return (p.titles || []).filter(function (ti) {
      return t >= ti.start && t < ti.start + ti.dur;
    }).map(function (ti) {
      var into = t - ti.start, left = ti.start + ti.dur - t;
      var alpha = Math.min(1, into / TITLE_FADE, left / TITLE_FADE);
      return { title: ti, alpha: Math.max(0, alpha) };
    });
  }

  function audioAt(p, t) {
    return (p.audio || []).filter(function (a) {
      return t >= a.start && t < a.start + effDur(a);
    });
  }

  /* Split the video clip under t; returns true if a split happened. */
  function split(p, t) {
    var hit = videoAt(p, t);
    if (!hit) return false;
    var c = hit.clip;
    if (hit.srcTime <= c.in + 0.05 || hit.srcTime >= c.out - 0.05) return false;
    var second = {
      id: c.id + '_b', srcId: c.srcId, label: c.label,
      in: hit.srcTime, out: c.out, speed: c.speed || 1,
      trans: { type: 'cut', dur: 0 }
    };
    c.out = hit.srcTime;
    p.video.splice(hit.i + 1, 0, second);
    return true;
  }

  function move(arr, from, to) {
    if (from === to || from < 0 || from >= arr.length || to < 0 || to >= arr.length) return;
    var it = arr.splice(from, 1)[0];
    arr.splice(to, 0, it);
  }

  function clampTrim(c, srcDur) {
    var max = srcDur > 0 ? srcDur : Infinity;
    if (!(c.in >= 0)) c.in = 0;
    if (!(c.out > 0)) c.out = Math.min(max, c.in + 1);
    c.out = Math.min(c.out, max);
    if (c.out - c.in < 0.1) c.out = Math.min(max, c.in + 0.1);
    if (c.out - c.in < 0.1) c.in = Math.max(0, c.out - 0.1);
    return c;
  }

  /* ── timecode + EDL ─────────────────────────────────────────────── */
  function tc(sec, fps) {
    fps = fps || 24;
    var totalF = Math.round(sec * fps);
    var f = totalF % fps;
    var s = Math.floor(totalF / fps) % 60;
    var m = Math.floor(totalF / fps / 60) % 60;
    var h = Math.floor(totalF / fps / 3600);
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return p2(h) + ':' + p2(m) + ':' + p2(s) + ':' + p2(f);
  }

  function edl(p) {
    var fps = p.fps || 24;
    var lines = ['TITLE: ' + (p.name || 'CINAMATE CUT'), 'FCM: NON-DROP FRAME', ''];
    var st = starts(p);
    (p.video || []).forEach(function (c, i) {
      var recIn = st[i], recOut = st[i] + effDur(c);
      var n = String(i + 1);
      while (n.length < 3) n = '0' + n;
      lines.push(n + '  AX       V     C        ' +
        tc(c.in, fps) + ' ' + tc(c.out, fps) + ' ' + tc(recIn, fps) + ' ' + tc(recOut, fps));
      lines.push('* FROM CLIP NAME: ' + (c.label || 'CLIP ' + (i + 1)));
      if ((c.speed || 1) !== 1) lines.push('* SPEED: ' + Math.round((c.speed || 1) * 100) + '%');
      lines.push('');
    });
    return lines.join('\n');
  }

  /* ── OpenTimelineIO JSON (Timeline.1 schema) ────────────────────── */
  function rt(seconds, fps) {
    return { OTIO_SCHEMA: 'RationalTime.1', rate: fps, value: Math.round(seconds * fps) };
  }
  function otio(p, srcMap) {
    var fps = p.fps || 24;
    srcMap = srcMap || {};
    var videoChildren = (p.video || []).map(function (c) {
      return {
        OTIO_SCHEMA: 'Clip.2',
        name: c.label || c.id,
        source_range: {
          OTIO_SCHEMA: 'TimeRange.1',
          start_time: rt(c.in, fps),
          duration: rt(c.out - c.in, fps)
        },
        media_references: {
          DEFAULT_MEDIA: {
            OTIO_SCHEMA: 'ExternalReference.1',
            target_url: (srcMap[c.srcId] && srcMap[c.srcId].url) || (c.srcId || ''),
            name: c.label || ''
          }
        },
        active_media_reference_key: 'DEFAULT_MEDIA',
        effects: (c.speed || 1) !== 1 ? [{
          OTIO_SCHEMA: 'LinearTimeWarp.1', name: 'speed', time_scalar: c.speed
        }] : [],
        markers: [], enabled: true, metadata: {}
      };
    });
    var audioChildren = (p.audio || []).map(function (a, i) {
      var kids = [];
      if (a.start > 0) {
        kids.push({
          OTIO_SCHEMA: 'Gap.1', name: 'gap',
          source_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: rt(0, fps), duration: rt(a.start, fps) }
        });
      }
      kids.push({
        OTIO_SCHEMA: 'Clip.2', name: a.label || 'audio ' + (i + 1),
        source_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: rt(a.in, fps), duration: rt(a.out - a.in, fps) },
        media_references: {
          DEFAULT_MEDIA: { OTIO_SCHEMA: 'ExternalReference.1', target_url: (srcMap[a.srcId] && srcMap[a.srcId].url) || (a.srcId || ''), name: a.label || '' }
        },
        active_media_reference_key: 'DEFAULT_MEDIA',
        effects: [], markers: [], enabled: true, metadata: {}
      });
      return kids;
    });
    var tracks = [{
      OTIO_SCHEMA: 'Track.1', name: 'V1', kind: 'Video',
      children: videoChildren, markers: [], effects: [], enabled: true, metadata: {},
      source_range: null
    }];
    if (audioChildren.length) {
      tracks.push({
        OTIO_SCHEMA: 'Track.1', name: 'A1', kind: 'Audio',
        children: [].concat.apply([], audioChildren), markers: [], effects: [], enabled: true, metadata: {},
        source_range: null
      });
    }
    return {
      OTIO_SCHEMA: 'Timeline.1',
      name: p.name || 'CINAMATE CUT',
      global_start_time: rt(0, fps),
      tracks: {
        OTIO_SCHEMA: 'Stack.1', name: 'tracks', children: tracks,
        markers: [], effects: [], enabled: true, metadata: {}, source_range: null
      },
      metadata: { cinamate: { generator: 'CINAMATE Editor', fps: fps } }
    };
  }

  /* ── waveform peaks ─────────────────────────────────────────────── */
  function peaks(channel, buckets) {
    var n = channel.length;
    buckets = Math.max(1, buckets | 0);
    var out = new Float32Array(buckets);
    if (!n) return out;
    var per = n / buckets;
    for (var b = 0; b < buckets; b++) {
      var s = Math.floor(b * per), e = Math.min(n, Math.floor((b + 1) * per) || s + 1);
      var m = 0;
      for (var i = s; i < e; i++) { var v = channel[i] < 0 ? -channel[i] : channel[i]; if (v > m) m = v; }
      out[b] = m;
    }
    return out;
  }

  /* ── assistant: rough cut, silence, beats, color ───────────────────
     Deterministic signal-processing assists — the editor's AI hands.  */

  /* One-click rough assembly: sources [{id, dur, scene, label}] in story
     order → ripple video track, crossfading on scene changes. */
  function assemble(p, sources, opts) {
    opts = opts || {};
    var handle = opts.handle != null ? opts.handle : 0.25;
    var fade = opts.crossfade != null ? opts.crossfade : 0.75;
    p.video = [];
    var lastScene = null;
    (sources || []).forEach(function (s, k) {
      if (!(s.dur > 0.4)) return;
      var trim = Math.min(handle, s.dur / 4);
      var sceneChanged = lastScene != null && s.scene != null && s.scene !== lastScene;
      p.video.push({ id: 'as' + k, srcId: s.id, label: s.label || ('Shot ' + (k + 1)),
        in: trim, out: s.dur - trim, speed: 1,
        trans: sceneChanged ? { type: 'crossfade', dur: fade } : { type: 'cut', dur: 0 } });
      if (s.scene != null) lastScene = s.scene;
    });
    return p.video.length;
  }

  /* Silence regions in an amplitude envelope (0..1 per sample at `rate`/s). */
  function silences(env, rate, opts) {
    opts = opts || {};
    var thresh = opts.threshold != null ? opts.threshold : 0.04;
    var minDur = opts.minDur != null ? opts.minDur : 0.35;
    var out = [], startI = -1;
    for (var i = 0; i <= env.length; i++) {
      var quiet = i < env.length && env[i] < thresh;
      if (quiet && startI < 0) startI = i;
      if (!quiet && startI >= 0) {
        var s = startI / rate, e = i / rate;
        if (e - s >= minDur) out.push({ start: s, end: e });
        startI = -1;
      }
    }
    return out;
  }

  /* Tighten: pull each clip's in/out past leading/trailing silence in its
     source (silBySrc: {srcId: [{start,end}]}). Returns seconds removed. */
  function tighten(p, silBySrc, opts) {
    opts = opts || {};
    var pad = opts.pad != null ? opts.pad : 0.12; // keep a breath
    var removed = 0;
    (p.video || []).forEach(function (c) {
      (silBySrc[c.srcId] || []).forEach(function (r) {
        if (r.start <= c.in + 0.02 && r.end > c.in) {
          var to = Math.min(r.end - pad, c.out - 0.4);
          if (to > c.in) { removed += to - c.in; c.in = to; }
        }
        if (r.end >= c.out - 0.02 && r.start < c.out) {
          var to2 = Math.max(r.start + pad, c.in + 0.4);
          if (to2 < c.out) { removed += c.out - to2; c.out = to2; }
        }
      });
    });
    return Math.round(removed * 10) / 10;
  }

  /* Beat times from an energy envelope: rising peaks above the trailing
     average, spaced at least minGap apart. */
  function beats(env, rate, opts) {
    opts = opts || {};
    var win = Math.max(4, Math.round((opts.window || 1.0) * rate));
    var factor = opts.factor != null ? opts.factor : 1.5;
    var gap = opts.minGap != null ? opts.minGap : 0.25;
    var out = [], buf = [], sum = 0, lastBeat = -1e9;
    for (var i = 0; i < env.length; i++) {
      var avg = buf.length ? sum / buf.length : 0;
      var tSec = i / rate;
      if (buf.length >= 4 && env[i] > avg * factor && env[i] > 0.08 &&
          env[i] >= (env[i - 1] || 0) && tSec - lastBeat >= gap) {
        out.push(Math.round(tSec * 100) / 100);
        lastBeat = tSec;
      }
      buf.push(env[i]); sum += env[i];
      if (buf.length > win) sum -= buf.shift();
    }
    return out;
  }

  /* Re-slice the video track so every cut lands on a beat, cycling through
     the existing clips. srcDur: {srcId: seconds}. */
  function cutToBeats(p, beatTimes, srcDur) {
    var clips = (p.video || []).filter(function (c) { return (srcDur[c.srcId] || 0) > 0.25; });
    if (!clips.length || !beatTimes || beatTimes.length < 2) return 0;
    var out = [], k = 0;
    for (var b = 0; b < beatTimes.length - 1; b++) {
      var span = beatTimes[b + 1] - beatTimes[b];
      if (span < 0.2) continue;
      var src = clips[k % clips.length]; k++;
      var d = srcDur[src.srcId];
      var take = Math.min(span, d - 0.05);
      var start = Math.max(0, Math.min(src.in, d - take));
      out.push({ id: 'bt' + b, srcId: src.srcId, label: src.label,
        in: start, out: start + take, speed: 1, trans: { type: 'cut', dur: 0 } });
    }
    if (out.length) p.video = out;
    return out.length;
  }

  /* Per-clip color → canvas filter string (applies in preview AND export). */
  function cssFilter(color) {
    if (!color) return 'none';
    var f = [];
    if (color.ex != null && +color.ex !== 1) f.push('brightness(' + color.ex + ')');
    if (color.ct != null && +color.ct !== 1) f.push('contrast(' + color.ct + ')');
    if (color.sat != null && +color.sat !== 1) f.push('saturate(' + color.sat + ')');
    if (color.tw > 0) f.push('sepia(' + (0.3 * color.tw).toFixed(2) + ')');
    else if (color.tw < 0) f.push('hue-rotate(' + Math.round(24 * color.tw) + 'deg)');
    return f.length ? f.join(' ') : 'none';
  }

  /* Auto balance from a 256-bin luma histogram: percentile stretch for
     contrast, mid-grey pull for exposure. */
  function autoColor(hist) {
    var total = 0, mean = 0, i;
    for (i = 0; i < 256; i++) { total += hist[i]; mean += i * hist[i]; }
    if (!total) return { ex: 1, ct: 1, sat: 1, tw: 0 };
    mean /= total;
    var cum = 0, p5 = 0, p95 = 255;
    for (i = 0; i < 256; i++) { cum += hist[i]; if (cum >= total * 0.05) { p5 = i; break; } }
    cum = 0;
    for (i = 255; i >= 0; i--) { cum += hist[i]; if (cum >= total * 0.05) { p95 = i; break; } }
    var ct = Math.max(1, Math.min(1.6, 235 / Math.max(40, p95 - p5)));
    var ex = Math.max(0.7, Math.min(1.5, 118 / Math.max(30, mean)));
    return { ex: Math.round(ex * 100) / 100, ct: Math.round(ct * 100) / 100, sat: 1, tw: 0 };
  }

  root.CCut = {
    blank: blank, effDur: effDur, starts: starts, duration: duration,
    videoAt: videoAt, titlesAt: titlesAt, audioAt: audioAt,
    split: split, move: move, clampTrim: clampTrim,
    tc: tc, edl: edl, otio: otio, peaks: peaks,
    assemble: assemble, silences: silences, tighten: tighten,
    beats: beats, cutToBeats: cutToBeats,
    cssFilter: cssFilter, autoColor: autoColor
  };
})(typeof window !== 'undefined' ? window : globalThis);
