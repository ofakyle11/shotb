/* Module — Reference kits: multi-view character turnarounds + location angle
   plates, generated with nano-banana-pro (subject consistency from a single
   reference) through the existing generate_picture route. The resolver picks
   the kit image that matches each clip's shot type, so a close-up sends the
   front portrait while a wide sends the full-body — same canonical person. */
window.SBRefKit = (function () {
  'use strict';

  var CHAR_VIEWS = [
    { key: 'front', label: 'Front', aspect: '2:3',
      prompt: 'Character reference portrait, front view, chest-up, facing camera, neutral expression, even soft studio lighting, plain dark backdrop.' },
    { key: 'threeQuarter', label: '3/4 view', aspect: '2:3',
      prompt: 'Three-quarter view portrait, head and shoulders turned 45 degrees, neutral expression, same soft studio lighting, plain dark backdrop.' },
    { key: 'profile', label: 'Profile', aspect: '2:3',
      prompt: 'Side profile portrait, head and shoulders in full left profile, neutral expression, same soft studio lighting, plain dark backdrop.' },
    { key: 'fullBody', label: 'Full body', aspect: '2:3',
      prompt: 'Full body reference, standing straight, neutral pose, head to toe visible, same soft studio lighting, plain dark backdrop.' }
  ];

  var LOC_VIEWS = [
    { key: 'plate', label: 'Main plate', aspect: '16:9',
      prompt: 'Location reference plate, eye-level main view, no people.' },
    { key: 'reverse', label: 'Reverse', aspect: '16:9',
      prompt: 'Reverse angle of EXACTLY the same location, camera turned 180 degrees, same architecture, same materials, same lighting, no people.' },
    { key: 'wide', label: 'Wide', aspect: '16:9',
      prompt: 'Wide establishing shot of EXACTLY the same location, pulled back to show the full space, same architecture, same lighting, no people.' }
  ];

  var SAME_PERSON = ' EXACTLY the same person as the reference image — identical face, hair, build, skin tone, and wardrobe. This is a character turnaround sheet frame.';
  var SAME_PLACE = ' Match the reference image exactly — same location, same set dressing, same palette.';

  function isHttps(u) { return typeof u === 'string' && u.trim().indexOf('https://') === 0; }

  function charBaseDesc(name, c) {
    var d = ((c && c.description) || name || 'the character').trim();
    var w = (c && c.wardrobe) ? (' Wearing: ' + c.wardrobe + '.') : '';
    return d + w;
  }

  /* gen(opts) -> Promise<httpsUrl>. Generates missing views in order; the front
     portrait (existing refUrl or freshly generated) seeds every other view. */
  async function buildCharacterKit(name, c, gen, onEach) {
    if (!c.kit) c.kit = {};
    var base = charBaseDesc(name, c);
    var front = isHttps(c.kit.front) ? c.kit.front : (isHttps(c.refUrl) ? c.refUrl : null);
    if (!front) {
      front = await gen({ type: 'character', name: name, desc: CHAR_VIEWS[0].prompt + ' ' + base, aspect_ratio: CHAR_VIEWS[0].aspect });
    }
    c.kit.front = front;
    if (!isHttps(c.refUrl)) c.refUrl = front;
    if (onEach) onEach('front', front);
    for (var i = 1; i < CHAR_VIEWS.length; i++) {
      var v = CHAR_VIEWS[i];
      if (isHttps(c.kit[v.key])) continue;
      var url = await gen({
        type: 'character', name: name,
        desc: v.prompt + SAME_PERSON + ' ' + base,
        aspect_ratio: v.aspect,
        referenceImages: [{ url: front }]
      });
      c.kit[v.key] = url;
      if (onEach) onEach(v.key, url);
    }
    return c.kit;
  }

  async function buildLocationKit(loc, gen, onEach) {
    if (!loc.kit) loc.kit = {};
    var base = ((loc.description || loc.name || 'the location') + (loc.consistencyPhrase ? ' ' + loc.consistencyPhrase : '')).trim();
    var plate = isHttps(loc.kit.plate) ? loc.kit.plate : (isHttps(loc.plateUrl) ? loc.plateUrl : null);
    if (!plate) {
      plate = await gen({ type: 'location', name: loc.name, desc: LOC_VIEWS[0].prompt + ' ' + base, aspect_ratio: LOC_VIEWS[0].aspect });
    }
    loc.kit.plate = plate;
    if (!isHttps(loc.plateUrl)) loc.plateUrl = plate;
    if (onEach) onEach('plate', plate);
    for (var i = 1; i < LOC_VIEWS.length; i++) {
      var v = LOC_VIEWS[i];
      if (isHttps(loc.kit[v.key])) continue;
      var url = await gen({
        type: 'location', name: loc.name,
        desc: v.prompt + SAME_PLACE + ' ' + base,
        aspect_ratio: v.aspect,
        referenceImages: [{ url: plate }]
      });
      loc.kit[v.key] = url;
      if (onEach) onEach(v.key, url);
    }
    return loc.kit;
  }

  /* Regenerate a single view (front/plate re-seed everything downstream, so
     only the one image is replaced here — rebuild the kit for a full refresh). */
  async function regenerateCharView(name, c, viewKey, gen) {
    var v = CHAR_VIEWS.filter(function (x) { return x.key === viewKey; })[0];
    if (!v) throw new Error('Unknown view ' + viewKey);
    if (!c.kit) c.kit = {};
    var seed = viewKey === 'front' ? null : (isHttps(c.kit.front) ? c.kit.front : (isHttps(c.refUrl) ? c.refUrl : null));
    var url = await gen({
      type: 'character', name: name,
      desc: v.prompt + (seed ? SAME_PERSON : '') + ' ' + charBaseDesc(name, c),
      aspect_ratio: v.aspect,
      referenceImages: seed ? [{ url: seed }] : undefined
    });
    c.kit[v.key] = url;
    if (viewKey === 'front' && !isHttps(c.refUrl)) c.refUrl = url;
    return url;
  }

  async function regenerateLocView(loc, viewKey, gen) {
    var v = LOC_VIEWS.filter(function (x) { return x.key === viewKey; })[0];
    if (!v) throw new Error('Unknown view ' + viewKey);
    if (!loc.kit) loc.kit = {};
    var seed = viewKey === 'plate' ? null : (isHttps(loc.kit.plate) ? loc.kit.plate : (isHttps(loc.plateUrl) ? loc.plateUrl : null));
    var base = ((loc.description || loc.name || '') + (loc.consistencyPhrase ? ' ' + loc.consistencyPhrase : '')).trim();
    var url = await gen({
      type: 'location', name: loc.name,
      desc: v.prompt + (seed ? SAME_PLACE : '') + ' ' + base,
      aspect_ratio: v.aspect,
      referenceImages: seed ? [{ url: seed }] : undefined
    });
    loc.kit[v.key] = url;
    if (viewKey === 'plate' && !isHttps(loc.plateUrl)) loc.plateUrl = url;
    return url;
  }

  /* Shot-type → kit view. Close-ups get the front portrait, wides the full
     body, over-shoulder/profile shots the angled views. */
  function pickCharKitImage(c, shotType) {
    var kit = (c && c.kit) || {};
    var st = String(shotType || '').toUpperCase();
    function first() {
      for (var i = 0; i < arguments.length; i++) if (isHttps(kit[arguments[i]])) return kit[arguments[i]];
      return null;
    }
    if (/(WIDE|ESTABLISHING|MASTER|FULL|LONG)/.test(st)) return first('fullBody', 'threeQuarter', 'front');
    if (/(OTS|OVER.?THE.?SHOULDER|PROFILE|SIDE)/.test(st)) return first('profile', 'threeQuarter', 'front');
    if (/(TWO.?SHOT|MEDIUM)/.test(st)) return first('threeQuarter', 'front', 'fullBody');
    return first('front', 'threeQuarter', 'fullBody');
  }

  function pickLocKitImage(loc, shotType) {
    var kit = (loc && loc.kit) || {};
    var st = String(shotType || '').toUpperCase();
    function first() {
      for (var i = 0; i < arguments.length; i++) if (isHttps(kit[arguments[i]])) return kit[arguments[i]];
      return null;
    }
    if (/(WIDE|ESTABLISHING|MASTER)/.test(st)) return first('wide', 'plate', 'reverse');
    if (/REVERSE/.test(st)) return first('reverse', 'plate', 'wide');
    return first('plate', 'wide', 'reverse');
  }

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  function kitStripHtml(views, kit, btnId, buildLabel) {
    kit = kit || {};
    var cells = views.map(function (v) {
      var url = kit[v.key];
      return '<div class="kit-cell' + (isHttps(url) ? '' : ' empty') + '">' +
        (isHttps(url) ? '<img src="' + esc(url) + '" alt="' + esc(v.label) + '">' : '<span class="kit-ph">—</span>') +
        '<span class="kit-label">' + esc(v.label) + '</span>' +
        (isHttps(url) ? '<button type="button" class="kit-regen" data-kit-view="' + esc(v.key) + '" title="Regenerate this view">↻</button>' : '') +
        '</div>';
    }).join('');
    var done = views.every(function (v) { return isHttps(kit[v.key]); });
    return '<div class="field"><label>Reference kit' + (done ? ' <span class="kit-done">complete</span>' : '') + '</label>' +
      '<div class="kit-strip">' + cells + '</div>' +
      '<button type="button" class="tb-btn' + (done ? '' : ' gold') + '" id="' + btnId + '">' + (done ? '↻ Rebuild kit' : buildLabel) + '</button></div>';
  }

  function renderCharKitHtml(c) { return kitStripHtml(CHAR_VIEWS, c && c.kit, 'btnBuildCharKit', '✨ Build kit (4 views)'); }
  function renderLocKitHtml(loc) { return kitStripHtml(LOC_VIEWS, loc && loc.kit, 'btnBuildLocKit', '✨ Build kit (3 angles)'); }

  return {
    CHAR_VIEWS: CHAR_VIEWS,
    LOC_VIEWS: LOC_VIEWS,
    buildCharacterKit: buildCharacterKit,
    buildLocationKit: buildLocationKit,
    regenerateCharView: regenerateCharView,
    regenerateLocView: regenerateLocView,
    pickCharKitImage: pickCharKitImage,
    pickLocKitImage: pickLocKitImage,
    renderCharKitHtml: renderCharKitHtml,
    renderLocKitHtml: renderLocKitHtml
  };
})();
