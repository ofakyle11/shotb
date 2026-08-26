/* CINAMATE — the shared application chrome: ONE topbar, ONE toast.
 *
 * WHY THIS FILE EXISTS
 *
 * Twenty-eight module pages hand-copied `<header class="topbar">` — logo,
 * meta, spacer, two to four `tb-btn` links — and every one of them picked a
 * different ad-hoc link set. Four of them (`producer/`, `timeline/`, `tools/`,
 * `today/`) shipped with no Dashboard link at all, so from those pages the
 * operations dashboard simply did not exist. That is not a typo anybody can be
 * told to stop making: there was no shared statement anywhere of where you can
 * go from where, so "did you remember the Dashboard link" was a code-review
 * question, twenty-eight times, forever.
 *
 * So the link set is not written per page any more. `CChrome.NAV` is the one
 * registry of destinations, and `navLinks()` ALWAYS emits HOME first and HUB
 * last around whatever else a page asks for. A page cannot omit the Dashboard
 * link, because a page never supplies it. It can only add to the set, and an
 * id that is not in the registry throws rather than rendering nothing.
 *
 * The same twenty-seven pages each carried their own `<div class="toast">`
 * and their own four-line `toast()` with a duration between 2600ms and 3200ms.
 * There is one here, it adopts whatever toast element a page already has, and
 * it creates one when a page has none.
 *
 * SECURITY
 *
 * This file builds markup from data, so it is an HTML sink. Every value
 * interpolated below goes through esc(); every URL goes through
 * CinUrl.safe(), because the CSP carries 'unsafe-inline' and an escaped
 * `javascript:` href still executes. There is deliberately NO raw-HTML slot in
 * the model — a page that needs markup this component cannot describe keeps
 * that markup in its own HTML and marks it `data-tb-keep="name"`, and the
 * component re-homes the real node into a `{kind:'slot'}` placeholder. Nothing
 * a page owns is ever round-tripped through a string.
 *
 * LOAD ORDER (hard contract, guarded below)
 *   js/safe-url.js  →  js/ui-chrome.js  →  the page's own script
 *
 * USAGE
 *   <header class="topbar" id="cinTopbar"></header>
 *   <script>
 *     CChrome.topbar('cinTopbar', {
 *       here: 'today',
 *       meta: 'Today — the day, in your pocket',
 *       links: ['producer#schedule', 'dailies']
 *     });
 *   </script>
 *
 * All original code, written for Cinamate.
 */
(function (root) {
  'use strict';

  /* Throw at load, not at first render: a missing CinUrl means every href this
     file emits would silently become '' and the topbar would render a row of
     dead links, which looks like a styling bug and is a security control that
     is not running. Naming the file in the message is also how
     scripts/test_assurance.mjs resolves the dependency automatically. */
  if (!root.CinUrl) {
    throw new Error('js/ui-chrome.js requires js/safe-url.js — load <script src="/js/safe-url.js"> before it');
  }

  /* The same five characters every escaper in this repo covers. The apostrophe
     matters because a value dropped into a single-quoted attribute can break
     out of it. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ── the nav model ────────────────────────────────────────────────────────
   * THE single source of truth for what destinations exist. One entry per
   * page, with the label and tooltip that page is called by everywhere. To add
   * a destination, add it here; to rename one, rename it here. A page names
   * ids, never hrefs, so no page can invent a link to somewhere that is not on
   * this list, and renaming a route is one edit rather than twenty-eight.
   * ────────────────────────────────────────────────────────────────────── */
  var NAV = {
    dashboard:    { href: '/dashboard.html', label: '⊞ Dashboard',  title: 'Operations dashboard' },
    timeline:     { href: '/timeline/',      label: '← Studio',     title: 'The Studio — script, clips, timeline' },
    today:        { href: '/today/',         label: 'Today',             title: "Today's call sheet, phone-sized" },
    projects:     { href: '/projects/',      label: 'Projects',          title: 'Back up, restore, switch production' },
    workflow:     { href: '/workflow/',      label: 'Workflow',          title: 'The pipeline, end to end' },
    tools:        { href: '/tools/',         label: '🧰 Tools', title: 'Production tools' },
    producer:     { href: '/producer/',      label: 'Producer Suite',    title: 'Budget, stripboard, incentives, sales' },
    writer:       { href: '/writer/',        label: '✎ Writer',     title: 'Treatment to screenplay' },
    boards:       { href: '/boards/',        label: 'Boards',            title: 'Shot lists, storyboards, key art' },
    editor:       { href: '/editor/',        label: 'Editor',            title: 'The cut — NLE, titles, export' },
    screening:    { href: '/screening/',     label: 'Screening Room',    title: 'Notes at the frame, not in an email' },
    casting:      { href: '/casting/',       label: 'Casting Office',    title: 'Roles, candidates, sides, offers' },
    production:   { href: '/production/',    label: 'Production Office', title: 'Continuity, DPR, VFX cues, QC, residuals' },
    locations:    { href: '/locations/',     label: 'Locations',         title: 'Scout book, permits, stages' },
    sets:         { href: '/sets/',          label: 'Set Designer',      title: 'Plans the art department can build from' },
    props:        { href: '/props/',         label: 'Props',             title: 'Breakdown, budget, sourcing' },
    wardrobe:     { href: '/wardrobe/',      label: 'Wardrobe',          title: 'Change plot, budget, continuity' },
    safety:       { href: '/safety/',        label: 'Safety',            title: 'Assessments, police, incidents' },
    dailies:      { href: '/dailies/',       label: 'Dailies',           title: 'Takes, circles, on-set reports' },
    vfx:          { href: '/vfx/',           label: 'VFX',               title: 'Shot board, bids, plates, day sheet' },
    post:         { href: '/post/',          label: 'Post',              title: 'Calendar, versions, vendor bids, delivery' },
    music:        { href: '/music/',         label: 'Music',             title: 'Cues, licensing, cue sheet' },
    finance:      { href: '/finance/',       label: 'Money Room',        title: 'POs, petty cash, weekly cost report' },
    contracts:    { href: '/contracts/',     label: 'Deal Memos',        title: 'From handshake to cost report' },
    investors:    { href: '/investors/',     label: 'Investor Room',     title: 'Cap table, waterfall, statements' },
    taxcredit:    { href: '/taxcredit/',     label: 'Tax Credit',        title: 'Qualified spend, credit estimate' },
    clearance:    { href: '/clearance/',     label: 'Clearance',         title: 'The pre-E&O script read' },
    festivals:    { href: '/festivals/',     label: 'Festivals',         title: 'Premieres, submissions, buyers' },
    distribution: { href: '/distribution/',  label: 'Distribution',      title: 'Deliverables, windows, screeners' }
  };

  /* HOME is always the first link on every page and HUB always the last —
     which is exactly the order the twenty-four pages that got it right already
     used, so adopting this changes nothing visible on them. Neither is ever
     supplied by a page, which is what makes forgetting one impossible. */
  var HOME = 'dashboard';
  var HUB = 'timeline';

  /* Pure — no DOM. This is the part worth testing, and scripts/test_ui_chrome.mjs
     asserts on it directly: every page's link set contains HOME unless the page
     IS home. Returns [{id, href, label, title}]. */
  function navLinks(model) {
    model = model || {};
    var here = model.here || '';
    var refs = [HOME].concat(model.links || []).concat([HUB]);
    var out = [], seen = {};
    for (var i = 0; i < refs.length; i++) {
      var ref = String(refs[i]);
      var hash = ref.indexOf('#');
      var id = hash < 0 ? ref : ref.slice(0, hash);
      var entry = NAV[id];
      /* A typo must be loud. A silently dropped link is the failure this whole
         file exists to make impossible, so an unknown id is never rendered as
         nothing. */
      if (!entry) {
        throw new Error('js/ui-chrome.js: unknown nav id "' + id + '" — add it to CChrome.NAV');
      }
      if (id === here) continue;                       // you are already here
      var href = entry.href + (hash < 0 ? '' : ref.slice(hash));
      if (seen[href]) continue;
      seen[href] = 1;
      out.push({ id: id, href: href, label: entry.label, title: entry.title });
    }
    return out;
  }

  /* ── markup ───────────────────────────────────────────────────────────── */

  /* Constant: no interpolation, therefore not a sink. Identical to the header
     every module page hand-copied, so the rendering does not move by a pixel. */
  var LOGO =
    '<a class="logo" href="/dashboard.html" title="Back to the dashboard" style="color:inherit;text-decoration:none">' +
    '<img src="/assets/logo-mark.svg" alt="" style="width:22px;height:22px;vertical-align:-5px;margin-right:9px">' +
    'CINA<span>MATE</span></a>';

  /* Attribute helpers. Each emits nothing at all when the value is absent, so
     a control never carries an empty id="" or title="". */
  function attr(name, value) {
    return value == null || value === '' ? '' : ' ' + name + '="' + esc(value) + '"';
  }
  /* A class list is written by us, not typed by a user, but it lands unquoted
     in the middle of an attribute — so it is filtered to the character class a
     class name can legally have rather than merely escaped. */
  function cls(base, extra) {
    var ok = String(extra == null ? '' : extra).replace(/[^\w\s-]/g, '');
    return ' class="' + esc(base + (ok ? ' ' + ok : '')) + '"';
  }
  /* data-* attribute NAME (not value): same reasoning as cls(). */
  function dataName(v, fallback) {
    var ok = String(v == null ? '' : v).replace(/[^a-z0-9-]/gi, '');
    return ok || fallback;
  }

  function optionsHtml(options, value) {
    var list = options || [];
    var h = '';
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var val = o && typeof o === 'object' ? o.value : o;
      var lab = o && typeof o === 'object' ? (o.label == null ? o.value : o.label) : o;
      h += '<option' + attr('value', o && typeof o === 'object' ? val : null) +
        (String(value) === String(val) ? ' selected' : '') + '>' + esc(lab) + '</option>';
    }
    return h;
  }

  /* One control descriptor -> one element of markup. Kinds are a closed set on
     purpose: the model can describe a button, a link, a select, an input, a
     label, a tab strip, a spacer and a slot, and nothing else. Anything richer
     stays in the page's own HTML behind data-tb-keep. */
  function control(c) {
    if (!c) return '';
    switch (c.kind) {
      case 'gap':
        return '<span class="tb-gap"></span>';
      case 'slot':
        return '<span data-tb-slot="' + esc(c.name) + '"></span>';
      case 'text':
        return '<span' + cls('tb-meta', c.cls) + attr('id', c.id) + attr('title', c.title) + '>' +
          esc(c.label) + '</span>';
      case 'link':
        return '<a' + cls('tb-btn' + (c.gold ? ' gold' : ''), c.cls) + attr('id', c.id) +
          ' href="' + CinUrl.safe(c.to && NAV[c.to] ? NAV[c.to].href : c.href) + '"' +
          attr('title', c.title || (c.to && NAV[c.to] ? NAV[c.to].title : null)) + '>' +
          esc(c.label != null ? c.label : (c.to && NAV[c.to] ? NAV[c.to].label : '')) + '</a>';
      case 'select':
        return '<select' + cls('uc-sel', c.cls) + attr('id', c.id) + attr('title', c.title) +
          attr('style', c.style) + '>' + optionsHtml(c.options, c.value) + '</select>';
      case 'input':
        return '<input' + cls('tb-input', c.cls) + attr('id', c.id) + attr('title', c.title) +
          attr('placeholder', c.placeholder) + attr('value', c.value) + attr('style', c.style) + '>';
      case 'tabs':
        var name = dataName(c.attr, 'tab');
        var h = '<nav' + cls('ps-tabs', c.cls) + attr('id', c.id) + '>';
        for (var i = 0; i < (c.items || []).length; i++) {
          var t = c.items[i];
          h += '<button' + cls('ps-tab' + (t.on ? ' on' : ''), t.cls) + attr('id', t.id) +
            ' data-' + name + '="' + esc(t.value != null ? t.value : t.id) + '"' +
            attr('title', t.title) + '>' + esc(t.label) + '</button>';
        }
        return h + '</nav>';
      default:                                          // 'button'
        return '<button type="button"' + cls('tb-btn' + (c.gold ? ' gold' : ''), c.cls) +
          attr('id', c.id) + attr('title', c.title) + '>' + esc(c.label) + '</button>';
    }
  }

  function controls(list) {
    var h = '';
    for (var i = 0; i < (list || []).length; i++) h += control(list[i]);
    return h;
  }

  /* The whole header, as a string. Exposed for tests, which have no DOM. */
  function topbarHtml(model) {
    model = model || {};
    var h = LOGO;
    if (model.meta != null) {
      h += '<span class="tb-meta"' + attr('id', model.metaId) + attr('title', model.metaTitle) + '>' +
        esc(model.meta) + '</span>';
    }
    h += controls(model.left);
    h += '<div class="tb-spacer"></div>';
    h += controls(model.actions);
    var links = navLinks(model);
    for (var i = 0; i < links.length; i++) {
      h += '<a class="tb-btn" href="' + CinUrl.safe(links[i].href) + '"' +
        attr('title', links[i].title) + '>' + esc(links[i].label) + '</a>';
    }
    return h;
  }

  /* Render into a mount point. Returns the header element.
     Any child already carrying data-tb-keep="name" is detached, kept, and put
     back into the matching {kind:'slot', name} placeholder — the page's own
     node, never a copy of its markup. */
  function topbar(mount, model) {
    var doc = root.document;
    if (!doc) return null;
    var host = typeof mount === 'string' ? doc.getElementById(mount) : mount;
    if (!host) return null;

    var keep = {}, i;
    var kept = host.querySelectorAll ? host.querySelectorAll('[data-tb-keep]') : [];
    for (i = 0; i < kept.length; i++) keep[kept[i].getAttribute('data-tb-keep')] = kept[i];

    if (host.classList && !host.classList.contains('topbar')) host.classList.add('topbar');
    host.innerHTML = topbarHtml(model);

    var slots = host.querySelectorAll('[data-tb-slot]');
    for (i = 0; i < slots.length; i++) {
      var node = keep[slots[i].getAttribute('data-tb-slot')];
      if (node) slots[i].parentNode.replaceChild(node, slots[i]);
    }
    return host;
  }

  /* ── the one toast ────────────────────────────────────────────────────────
   * Adopts whatever the page already has — #cinToast, or the .toast /
   * .tk-toast div twenty-seven pages carry — and creates one when the page has
   * none, so a converted page can delete its own div without losing the
   * message. textContent, never innerHTML: a toast prints what a module hands
   * it, and that has come off a vendor invoice or a screenplay.
   * ────────────────────────────────────────────────────────────────────── */
  var TOAST_MS = 3000;
  var toastTimer = null;
  var toastNode = null;

  function toastEl() {
    var doc = root.document;
    if (!doc) return null;
    if (toastNode && toastNode.parentNode) return toastNode;
    toastNode = doc.getElementById('cinToast') || doc.querySelector('.toast, .tk-toast');
    if (toastNode) return toastNode;
    var host = doc.body || doc.documentElement;
    if (!host) return null;
    toastNode = doc.createElement('div');
    toastNode.className = 'toast';
    toastNode.id = 'cinToast';
    toastNode.setAttribute('aria-live', 'polite');
    host.appendChild(toastNode);
    return toastNode;
  }

  function toast(msg, ms) {
    var el = toastEl();
    if (!el) return;
    el.textContent = String(msg == null ? '' : msg);
    el.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, ms > 0 ? ms : TOAST_MS);
  }

  root.CChrome = {
    NAV: NAV, HOME: HOME, HUB: HUB, TOAST_MS: TOAST_MS,
    navLinks: navLinks, topbarHtml: topbarHtml, topbar: topbar,
    control: control, toast: toast, toastEl: toastEl, esc: esc
  };
})(typeof window !== 'undefined' ? window : globalThis);
