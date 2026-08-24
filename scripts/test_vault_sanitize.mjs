/* Vault boundary: productions arriving from another owner (studio cloud) or
 * from a file must not be able to carry markup into fields that modules
 * interpolate into HTML attributes — while real work is preserved byte for
 * byte. Run: node scripts/test_vault_sanitize.mjs */
import { readFileSync } from 'fs';
global.window = global;
(0, eval)(readFileSync(new URL('../projects/lib-vault.js', import.meta.url), 'utf8'));
const V = window.CVault;
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); } };
const mem = () => ({ _d: {}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=String(v); },
  removeItem(k){ delete this._d[k]; }, key(i){ return Object.keys(this._d)[i]; },
  get length(){ return Object.keys(this._d).length; } });

const BREAKOUT = 'x" onerror="alert(1)';

// 1. identifier fields lose the characters that break out of an attribute
let s = mem();
V.restore(s, { format: 'cinamate/1', stores: { SB_Boards_v1: JSON.stringify({
  scenes: [{ id: BREAKOUT, shots: [{ id: BREAKOUT, img: BREAKOUT }] }] }) } });
let o = JSON.parse(s.getItem('SB_Boards_v1'));
t('scene id cannot break an attribute', !/["'<>]/.test(o.scenes[0].id));
t('shot id cannot break an attribute', !/["'<>]/.test(o.scenes[0].shots[0].id));
t('hostile image url is dropped entirely', o.scenes[0].shots[0].img === '');

// 2. money-room identifiers
s = mem();
V.restore(s, { format: 'cinamate/1', stores: { SB_Money_v1: JSON.stringify({
  pos: [{ id: BREAKOUT, num: BREAKOUT, acct: BREAKOUT, vendor: 'Acme "Props" Ltd', amount: 100 }] }) } });
o = JSON.parse(s.getItem('SB_Money_v1'));
t('PO id sanitized', !/["'<>]/.test(o.pos[0].id));
t('PO number sanitized', !/["'<>]/.test(o.pos[0].num));
t('account code sanitized', !/["'<>]/.test(o.pos[0].acct));
/* Under default-deny a foreign archive's vendor name loses its quotes. That is
   the deliberate trade: only archives from OTHER owners are scrubbed, your own
   slots restore verbatim, and a lost quote mark beats a script execution. */
t('vendor keeps its words, loses its markup', o.pos[0].vendor === 'Acme Props Ltd');
t('numbers untouched', o.pos[0].amount === 100);

// 3. prose the product depends on survives exactly
s = mem();
const script = 'INT. BAR - NIGHT\n\nSHE\n"Don\'t <look> at me," she says.\n';
V.restore(s, { format: 'cinamate/1', stores: { SB_Timeline_v1: JSON.stringify({
  scriptText: script, title: 'The <Lighthouse> "Keeper"' }) } });
o = JSON.parse(s.getItem('SB_Timeline_v1'));
t('script text preserved byte for byte', o.scriptText === script);
t('title keeps its words, loses its markup', o.title === 'The Lighthouse Keeper');

// 4. legitimate media the app itself writes still loads
s = mem();
V.restore(s, { format: 'cinamate/1', stores: { SB_Boards_v1: JSON.stringify({
  scenes: [{ id: 's1', shots: [
    { id: 'sh1', img: 'data:image/png;base64,iVBORw0KGgo=' },
    { id: 'sh2', img: 'blob:https://cinamate-studio.netlify.app/abc' },
    { id: 'sh3', img: '/assets/frame.png' }] }] }) } });
o = JSON.parse(s.getItem('SB_Boards_v1'));
t('data: image kept', o.scenes[0].shots[0].img.startsWith('data:image/png;base64,'));
t('blob: url kept', o.scenes[0].shots[1].img.startsWith('blob:'));
t('site-relative path kept', o.scenes[0].shots[2].img === '/assets/frame.png');

// 4b. camelCase URL fields — the ones an exact-name list would miss
s = mem();
V.restore(s, { format: 'cinamate/1', stores: { SB_Timeline_v1: JSON.stringify({
  clips: [{ id: 'c1', videoUrl: BREAKOUT, activeClipUrl: BREAKOUT, posterImage: BREAKOUT,
            refUrl: 'https://example.com/ok.png', prompt: 'a "quiet" <room>' }] }) } });
o = JSON.parse(s.getItem('SB_Timeline_v1'));
t('videoUrl is scrubbed', o.clips[0].videoUrl === '');
t('activeClipUrl is scrubbed', o.clips[0].activeClipUrl === '');
t('posterImage is scrubbed', o.clips[0].posterImage === '');
t('a real https ref survives', o.clips[0].refUrl === 'https://example.com/ok.png');
t('prompt prose untouched', o.clips[0].prompt === 'a "quiet" <room>');

// 4c. the exact field names a name-based deny-list missed (found by review)
s = mem();
V.restore(s, { format: 'cinamate/1', stores: { SB_ScheduleBoard_v1: JSON.stringify({
  scenes: [{ num: '1', dn: BREAKOUT, eighths: 8 }] }) } });
o = JSON.parse(s.getItem('SB_ScheduleBoard_v1'));
t('dn is scrubbed', !/["'<>]/.test(o.scenes[0].dn));

s = mem();
V.restore(s, { format: 'cinamate/1', stores: { SB_Cut_v1: JSON.stringify({
  project: { clips: [{ srcId: BREAKOUT, durationSec: BREAKOUT, sec: BREAKOUT, rot: BREAKOUT }] } }) } });
o = JSON.parse(s.getItem('SB_Cut_v1'));
const clip = o.project.clips[0];
t('srcId is scrubbed', !/["'<>]/.test(clip.srcId));
t('durationSec is scrubbed', !/["'<>]/.test(clip.durationSec));
t('sec is scrubbed', !/["'<>]/.test(clip.sec));
t('rot is scrubbed', !/["'<>]/.test(clip.rot));

// 4d. a hostile scheme has no markup characters to strip
s = mem();
V.restore(s, { format: 'cinamate/1', stores: { SB_Props_v1: JSON.stringify({
  houses: [{ name: 'Acme', website: 'javascript:alert(1)', phone: 'JavaScript:alert(2)' }] }) } });
o = JSON.parse(s.getItem('SB_Props_v1'));
t('javascript: website is emptied', o.houses[0].website === '');
t('javascript: in a non-url field is emptied', o.houses[0].phone === '');

// 4e. an unknown future field name is covered by default, not by luck
s = mem();
V.restore(s, { format: 'cinamate/1', stores: { SB_Future_v1: JSON.stringify({
  rows: [{ someFieldNobodyAnticipated: BREAKOUT, x: 1, ok: true }] }) } });
o = JSON.parse(s.getItem('SB_Future_v1'));
t('an unanticipated field is scrubbed by default', !/["'<>]/.test(o.rows[0].someFieldNobodyAnticipated));
t('numbers survive', o.rows[0].x === 1);
t('booleans survive', o.rows[0].ok === true);

// 4f. the other half of the trade: YOUR OWN data is never scrubbed
s = mem();
s.setItem('SB_Money_v1', JSON.stringify({ pos: [{ vendor: 'Acme "Props" Ltd', id: 'a"b' }] }));
let mine = V.saveActive(s, '2026-01-01');
V.newProject(s, 'Other', '2026-01-01');
V.switchTo(s, mine.active, '2026-01-01');
o = JSON.parse(s.getItem('SB_Money_v1'));
t('own vendor keeps its quotes', o.pos[0].vendor === 'Acme "Props" Ltd');
t('own id keeps its quotes', o.pos[0].id === 'a"b');

// 5. prototype pollution through an archive
s = mem();
V.restore(s, { format: 'cinamate/1', stores: { SB_Props_v1: '{"__proto__":{"polluted":"yes"},"props":[]}' } });
t('prototype not polluted', ({}).polluted === undefined);

// 6. your OWN slots are never mangled
s = mem();
s.setItem('SB_Boards_v1', JSON.stringify({ scenes: [{ id: 'keep"me', shots: [] }] }));
let m = V.saveActive(s, '2026-01-01');
V.newProject(s, 'Second', '2026-01-01');
V.switchTo(s, m.active, '2026-01-01');
o = JSON.parse(s.getItem('SB_Boards_v1'));
t('own slot round-trips untouched', o.scenes[0].id === 'keep"me');

// 7. non-JSON store values pass through
s = mem();
V.restore(s, { format: 'cinamate/1', stores: { SB_Note_v1: 'just a plain string' } });
t('non-JSON value preserved', s.getItem('SB_Note_v1') === 'just a plain string');

console.log('test_vault_sanitize: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
