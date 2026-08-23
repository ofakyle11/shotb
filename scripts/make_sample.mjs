#!/usr/bin/env node
/* Regenerate projects/sample.cinamate.json — the worked example production
 * the Projects page can load. Run: node scripts/make_sample.mjs            */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SCRIPT = `THE LIGHTHOUSE KEEPER

INT. LIGHTHOUSE - LAMP ROOM - NIGHT
Rain hammers the glass. MARA (60s, oilskin coat) trims the lamp wick with a pocket knife. A brass telescope rests on the rail. Below, the sea throws itself at the rocks.

EXT. CLIFF PATH - NIGHT
A lantern swings in the dark. DANIEL (30s) climbs against the wind, a leather satchel clutched to his chest, boots slipping on wet stone.

INT. LIGHTHOUSE - KITCHEN - NIGHT
Mara pours tea into two chipped mugs. Daniel spreads a sodden map across the table, weighting the corners with a candlestick and a coil of rope.

DANIEL
The freighter went down two miles out. Someone rowed away from her before she sank.

MARA
Then someone will come here. They always do.

INT. LIGHTHOUSE - STAIRWELL - NIGHT
The iron staircase coils upward. Mara climbs with the lantern; shadows spin around her like a zoetrope.

EXT. ROCKS BELOW THE LIGHT - NIGHT
A rowboat grinds onto the shingle. A figure in a naval greatcoat drags a strongbox above the tide line and looks up at the light.

INT. LIGHTHOUSE - LAMP ROOM - NIGHT
Through the telescope, Mara watches the figure. She lowers the glass, thinking, then snuffs the lamp. Darkness swallows the coast.

DANIEL (O.S.)
You put it out? In this weather?

MARA
A dark lighthouse says nobody's home.

INT. LIGHTHOUSE - KITCHEN - NIGHT
Daniel bolts the door. Mara takes a shotgun down from the rafters and lays it on the table beside the teapot, calm as setting cutlery.

EXT. LIGHTHOUSE - DOOR - NIGHT
The stranger, CREEL (50s), pounds on the oak door. Lightning shows the strongbox at his feet and the revolver in his belt.

INT. LIGHTHOUSE - KITCHEN - NIGHT
Mara opens the door on the chain. Rain and Creel's voice come through the gap.

CREEL
Keeper. I'll pay for one night and a blind eye.

MARA
The night's free. The blind eye you can't afford.

INT. LIGHTHOUSE - STOREROOM - NIGHT
Daniel wedges the strongbox behind sacks of flour. His lantern catches a name stenciled on its lid: the freighter's. And below it, a second name — his own.

INT. LIGHTHOUSE - LAMP ROOM - DAWN
The storm exhausted, Mara relights the lamp. The beam sweeps a grey, empty sea. On the rail, where the telescope stood, sits Creel's revolver — and two mugs of tea, still steaming.

MARA (V.O.)
Wrecks give up their cargo. Keepers keep what matters.

FADE OUT.`;

const stores = {
  SB_Timeline_v1: JSON.stringify({
    title: 'The Lighthouse Keeper',
    scriptText: SCRIPT,
    clips: []
  }),
  SB_BudgetSheet_v1: JSON.stringify({
    name: 'The Lighthouse Keeper — sample top sheet',
    preparedBy: 'CINAMATE sample',
    contingencyPct: 10,
    categories: [
      { acct: '1100', name: 'Story & Rights', items: [
        { id: 's1', desc: 'Original screenplay', amt: '', units: '', rate: '', est: 4500, actual: 0, notes: '' }] },
      { acct: '2000', name: 'Cast', items: [
        { id: 's2', desc: 'Mara — 6 days', amt: '', units: '', rate: '', est: 7226, actual: 0, notes: 'SAG scale' },
        { id: 's3', desc: 'Daniel — 5 days', amt: '', units: '', rate: '', est: 6020, actual: 0, notes: '' },
        { id: 's4', desc: 'Creel — 3 days', amt: '', units: '', rate: '', est: 3612, actual: 0, notes: '' }] },
      { acct: '3000', name: 'Production', items: [
        { id: 's5', desc: 'Lighthouse location — 6 days', amt: '', units: '', rate: '', est: 9000, actual: 0, notes: '' },
        { id: 's6', desc: 'Camera package', amt: '', units: '', rate: '', est: 5400, actual: 0, notes: '' },
        { id: 's7', desc: 'G&E package + rain rig', amt: '', units: '', rate: '', est: 6800, actual: 0, notes: '' },
        { id: 's8', desc: 'Props & set dressing', amt: '', units: '', rate: '', est: 3830, actual: 0, notes: 'see Props module' }] },
      { acct: '5000', name: 'Post', items: [
        { id: 's9', desc: 'Edit + grade + mix', amt: '', units: '', rate: '', est: 8200, actual: 0, notes: '' }] }
    ]
  }),
  SB_Props_v1: JSON.stringify({
    items: [
      { id: 'p1', name: 'Shotgun', cat: 'weapon', scenes: [8], qty: 1, mode: 'auto', hero: true, period: true, value: 0, actual: 0 },
      { id: 'p2', name: 'Revolver', cat: 'weapon', scenes: [9, 13], qty: 1, mode: 'auto', hero: false, period: true, value: 0, actual: 0 },
      { id: 'p3', name: 'Telescope', cat: 'handprop', scenes: [1, 7], qty: 1, mode: 'auto', hero: true, period: true, value: 0, actual: 0 },
      { id: 'p4', name: 'Lantern', cat: 'handprop', scenes: [2, 4, 12], qty: 3, mode: 'auto', hero: false, period: true, value: 0, actual: 0 },
      { id: 'p5', name: 'Strongbox', cat: 'specialty', scenes: [6, 12], qty: 1, mode: 'auto', hero: true, period: true, value: 0, actual: 0 },
      { id: 'p6', name: 'Map', cat: 'handprop', scenes: [3], qty: 2, mode: 'buy', hero: false, period: true, value: 0, actual: 0 },
      { id: 'p7', name: 'Rowboat', cat: 'vehicle', scenes: [6], qty: 1, mode: 'auto', hero: false, period: true, value: 0, actual: 0 },
      { id: 'p8', name: 'Tea set & mugs', cat: 'handprop', scenes: [3, 13], qty: 1, mode: 'buy', hero: false, period: false, value: 0, actual: 0 }
    ],
    city: 'Toronto, Canada', prod: 'The Lighthouse Keeper', dates: '', contact: '',
    weeks: 3, days: 6, phones: {}, houses: []
  }),
  SB_SetDesign_v1: JSON.stringify({
    v: 1, active: 'plan1',
    plans: [{
      id: 'plan1', name: 'Lighthouse kitchen — stage build', w: 24, h: 20,
      scenes: '3, 8, 10',
      items: [
        { id: 'w1', type: 'wall', x: 12, y: 1, w: 20, h: 0.5, rot: 0, label: 'Back flat' },
        { id: 'w2', type: 'wall', x: 2, y: 10, w: 18, h: 0.5, rot: 90, label: '' },
        { id: 'w3', type: 'wall', x: 22, y: 10, w: 18, h: 0.5, rot: 90, label: '' },
        { id: 'd1', type: 'door', x: 22, y: 16, w: 3, h: 0.5, rot: 90, label: 'Oak door' },
        { id: 'n1', type: 'window', x: 7, y: 1, w: 4, h: 0.4, rot: 0, label: 'Storm window' },
        { id: 't1', type: 'table', x: 12, y: 10, w: 5, h: 3, rot: 0, label: 'Kitchen table' },
        { id: 'c1', type: 'chair', x: 10, y: 13, w: 1.6, h: 1.6, rot: 0, label: '' },
        { id: 'c2', type: 'chair', x: 14, y: 13, w: 1.6, h: 1.6, rot: 180, label: '' },
        { id: 'k1', type: 'counter', x: 6, y: 3, w: 8, h: 2, rot: 0, label: 'Dresser & range' },
        { id: 'cam1', type: 'camera', x: 12, y: 17.5, w: 1.6, h: 1.6, rot: 0, lens: 32, label: 'A-cam' },
        { id: 'l1', type: 'light', x: 4, y: 17, w: 1.4, h: 1.4, rot: 40, label: 'Key 2K' },
        { id: 'l2', type: 'light', x: 20, y: 17, w: 1.4, h: 1.4, rot: -40, label: 'Fill' }
      ]
    }]
  }),
  SB_Crew_v1: JSON.stringify([
    { role: 'Director of Photography', name: '', union: 'IATSE', rate: '' },
    { role: 'First AC', name: '', union: 'IATSE', rate: '' },
    { role: 'Gaffer', name: '', union: 'IATSE', rate: '' },
    { role: 'Key Grip', name: '', union: 'IATSE', rate: '' },
    { role: 'Production Designer', name: '', union: 'IATSE', rate: '' },
    { role: 'Props Master', name: '', union: 'IATSE', rate: '' },
    { role: 'Sound Mixer', name: '', union: 'IATSE', rate: '' },
    { role: '1st AD', name: '', union: 'DGC', rate: '' },
    { role: 'Editor', name: '', union: '', rate: '' }
  ])
};

const archive = {
  format: 'cinamate/1',
  name: 'The Lighthouse Keeper (sample)',
  savedAt: 'sample',
  stores
};
const out = join(ROOT, 'projects', 'sample.cinamate.json');
writeFileSync(out, JSON.stringify(archive));
console.log('wrote', out, JSON.stringify(archive).length, 'bytes');
