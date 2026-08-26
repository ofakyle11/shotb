#!/usr/bin/env node
/* Node tests for props/lib-props.js (CProps) — run: node scripts/test_props.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/* the one scene model — lib-props.js reads its scenes from here */
(0, eval)(readFileSync(join(ROOT, 'js/lib-scenes.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'props/lib-props.js'), 'utf8'));
const P = globalThis.CProps;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

const SCRIPT = `INT. FARMHOUSE KITCHEN - NIGHT
Maggie sets the table. A shotgun leans by the door. On the counter, a
half-eaten cake and a bottle of whiskey.

EXT. COUNTRY ROAD - DAY
A rusted truck rattles past. Tom checks his watch, folds the map.

INT. STUDY - NIGHT
Bookshelves line the wall. A typewriter sits on the desk beside an oil lamp.
Tom loads the shotgun.`;

/* ── breakdown ── */
const scenes = P.splitScenes(SCRIPT);
t('splitScenes finds 3 scenes', scenes.length === 3);
t('slug preserved', /FARMHOUSE/.test(scenes[0].slug));
const items = P.breakdown(SCRIPT);
t('breakdown finds props', items.length >= 8);
const byName = {};
items.forEach(i => { byName[i.name.toLowerCase()] = i; });
t('shotgun found as weapon', byName.shotgun && byName.shotgun.cat === 'weapon');
t('shotgun spans scenes 1+3', byName.shotgun.scenes.join(',') === '1,3');
t('truck is a vehicle', byName.truck && byName.truck.cat === 'vehicle');
t('typewriter electronics', byName.typewriter && byName.typewriter.cat === 'electronics');
t('cake is food', byName.cake && byName.cake.cat === 'food');
t('watch is handprop', byName.watch && byName.watch.cat === 'handprop');
t('desk furniture', byName.desk && byName.desk.cat === 'furniture');
t('lamp setdress', byName.lamp && byName.lamp.cat === 'setdress');
t('items carry defaults', items.every(i => i.qty === 1 && i.mode === 'auto'));

/* ── pricing ── */
const plan = { weeks: 4, shootDays: 10 };
const hand = { id: 'x', name: 'Wallet', cat: 'handprop', scenes: [1], qty: 1, mode: 'auto' };
const pHand = P.priceItem(hand, plan);
// 10% of 75 = 7.5/wk; weeks 2-4 at 75% → 7.5*(1+0.75*3)=24.4 → rent
t('handprop rents cheap', pHand.mode === 'rent' && pHand.est > 0 && pHand.est < 75);
const longPlan = { weeks: 30, shootDays: 60 };
t('long run flips to buy', P.decide(hand, longPlan) === 'buy');
const food = P.priceItem({ id: 'f', name: 'Cake', cat: 'food', scenes: [1], qty: 2 }, plan);
t('food is buy-only per day', food.mode === 'buy' && food.est === 60 * 10 * 2);
const veh = P.priceItem({ id: 'v', name: 'Truck', cat: 'vehicle', scenes: [1, 2], qty: 1 }, plan);
t('vehicle priced per day', veh.est === 400 * Math.min(10, 4));
const hero = P.priceItem({ id: 'h', name: 'Sword', cat: 'weapon', scenes: [1], qty: 1, hero: true }, plan);
const plain = P.priceItem({ id: 'h2', name: 'Sword', cat: 'weapon', scenes: [1], qty: 1 }, plan);
t('hero flag triples value', Math.abs(hero.raw / plain.raw - 3) < 0.05);
const est = P.estimate([hand, { id: 'w', name: 'Shotgun', cat: 'weapon', scenes: [1], qty: 1 }], plan);
t('estimate totals add up', est.total === est.subtotal + est.armorer + est.contingency);
t('armorer added for weapons', est.armorer === P.ARMORER_DAY * 3);
t('no armorer without weapons', P.estimate([hand], plan).armorer === 0);
t('contingency is 10%', est.contingency === Math.round((est.subtotal + est.armorer) * 0.10));

/* ── learning hook ── */
delete globalThis.CLearn;
t('recordQuote safe without CLearn', P.recordQuote(hand, plan, 50) === 0);
let learned = null;
globalThis.CLearn = {
  calibration: () => ({ mult: 1.5, n: 3 }),
  learnBudget: (sheet) => { learned = sheet; return 1; }
};
const cal = P.priceItem(hand, plan);
t('calibration multiplies estimate', cal.mult === 1.5 && cal.est === Math.round(cal.raw * 1.5));
P.recordQuote(hand, plan, 44);
t('recordQuote feeds learnBudget with props acct', learned && learned.categories[0].acct === 'props:handprop');
delete globalThis.CLearn;

/* ── sourcing ── */
t('hub for ontario is Toronto', P.hubForIncentive('ontario').city.indexOf('Toronto') === 0);
t('hub for bc is Vancouver', P.hubForIncentive('bc').city.indexOf('Vancouver') === 0);
t('unknown incentive → null', P.hubForIncentive('nowhere') === null);
const tor = P.housesFor('Toronto, Canada');
t('toronto directory has houses', tor.length >= 2 && tor.every(h => h.source === 'directory'));
t('directory never invents phones', tor.every(h => h.phone === null));
const la = P.housesFor('los angeles');
t('LA directory rich', la.length >= 5);
t('nominatim url encodes city', P.buildNominatimUrl('New York').indexOf('New%20York') > 0);
t('nominatim parse', P.parseNominatim([{ lat: '43.6', lon: '-79.3', display_name: 'Toronto' }]).lat === 43.6);
t('nominatim parse empty → null', P.parseNominatim([]) === null);
const ql = P.buildOverpassQL(43.65, -79.38, 40);
t('overpass QL has radius+coords', ql.indexOf('around:40000,43.65,-79.38') > 0 && ql.indexOf('out:json') > 0);
const osm = P.parseOverpass({ elements: [
  { lat: 43.6, lon: -79.3, tags: { name: 'Prop City', shop: 'props', phone: '+1 416 555 0100', website: 'https://example.com' } },
  { center: { lat: 43.7, lon: -79.4 }, tags: { name: 'Malabar' } },
  { tags: {} }
] });
t('overpass parse keeps named, drops unnamed', osm.length === 2);
t('overpass phone/website carried', osm[0].phone === '+1 416 555 0100' && osm[0].website === 'https://example.com');
const merged = P.mergeHouses(tor, osm);
t('merge fills directory from map by name', merged.filter(h => h.name === 'Malabar').length === 1);
t('merge appends new map listings', merged.some(h => h.name === 'Prop City'));
t('search link quotes name', P.searchLink({ name: 'ISS' }, 'Los Angeles, USA').indexOf('%22ISS%22') > 0);

/* ── RFQ ── */
const text = P.rfq({ production: 'Night Harvest', dates: 'Oct 6-24', city: 'Toronto',
  house: 'Prop Portfolio', contact: 'K. Francis', items: est.rows });
t('rfq carries production+house', /Night Harvest/.test(text) && /Prop Portfolio/.test(text));
t('rfq lists items with qty', /Wallet\s+×1/.test(text));
t('rfq asks for rates', /weekly rental rates/.test(text));

console.log(`test_props: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
