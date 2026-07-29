/* Shotbreak — per-character dialogue voices (Kokoro-82M, Apache-2.0).
   Runs fully in the browser via transformers.js: the model (~45–90MB,
   cached after first load) synthesizes each character's lines on this
   device — free, private, no moderation. Every character gets a stable
   auto-assigned voice; override per character in the Cast editor. */
window.SBVoice = (function () {
  'use strict';

  var VOICES = [
    { id: 'af_heart',   label: 'Heart — warm US female' },
    { id: 'af_bella',   label: 'Bella — bright US female' },
    { id: 'af_nicole',  label: 'Nicole — soft US female' },
    { id: 'af_sky',     label: 'Sky — clear US female' },
    { id: 'am_adam',    label: 'Adam — deep US male' },
    { id: 'am_michael', label: 'Michael — warm US male' },
    { id: 'am_fenrir',  label: 'Fenrir — intense US male' },
    { id: 'bf_emma',    label: 'Emma — British female' },
    { id: 'bm_george',  label: 'George — British male' },
    { id: 'bm_lewis',   label: 'Lewis — deep British male' }
  ];

  var tts = null;
  var loading = null;

  async function load(onProgress) {
    if (tts) return tts;
    if (loading) return loading;
    loading = (async function () {
      if (onProgress) onProgress('Loading voice engine…');
      var mod = await import('https://cdn.jsdelivr.net/npm/kokoro-js@1/+esm');
      var device = 'wasm', dtype = 'q8';
      try {
        if (navigator.gpu && await navigator.gpu.requestAdapter()) { device = 'webgpu'; dtype = 'fp32'; }
      } catch (e) {}
      if (onProgress) onProgress('Downloading voice model (~45–90MB, first time only)…');
      var t = await mod.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: dtype, device: device });
      tts = t;
      return t;
    })();
    try { return await loading; } finally { loading = null; }
  }

  function hash(s) {
    var h = 2166136261; s = String(s || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* Stable per-character default so every film gets distinct voices with zero
     setup. Explicit choice (character editor) wins; 'none' silences. */
  function voiceFor(name, chars) {
    var c = (chars || {})[name] || {};
    if (c.ttsVoice === 'none') return null;
    if (c.ttsVoice && c.ttsVoice !== 'auto') return c.ttsVoice;
    return VOICES[hash('v|' + String(name || '').toUpperCase()) % VOICES.length].id;
  }

  function floatToWav(f32, rate) {
    var n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function ws(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var s = Math.max(-1, Math.min(1, f32[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buf);
  }

  /* Synthesize one line → 16-bit PCM WAV bytes ready for FFmpeg. */
  async function synthWav(text, voiceId, onProgress) {
    var t = await load(onProgress);
    var audio = await t.generate(String(text || '').trim(), { voice: voiceId });
    if (audio && typeof audio.toWav === 'function') return new Uint8Array(audio.toWav());
    var f32 = (audio && (audio.audio || audio.data)) || new Float32Array(0);
    var rate = (audio && audio.sampling_rate) || 24000;
    return floatToWav(f32, rate);
  }

  return { VOICES: VOICES, load: load, voiceFor: voiceFor, synthWav: synthWav, floatToWav: floatToWav };
})();
