#!/usr/bin/env node
/* The sink scanner is only a gate if something runs it. Its --check exited
 * non-zero on every commit for months, because 39 real interpolations in
 * app.html and one in netlify/functions/auth.js had never been read, so the
 * gate could not be wired to anything and nobody looked at its output. Those
 * 39 have now been read and recorded with reasons, --check passes, and this
 * keeps it passing.
 *
 * The second half proves the gate still bites: an already-reviewed expression
 * appearing one more time is a NEW sink nobody has read, and the allow-list
 * used to absorb it silently because it counted names rather than
 * occurrences.
 *
 * Run: node scripts/test_html_sinks.mjs
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCAN = join(ROOT, 'scripts', 'scan_html_sinks.mjs');
let pass = 0, fail = 0;
const t = (n, c, d) => { if (c) pass++; else { fail++; console.log('  x ' + n + (d ? '\n      ' + d : '')); } };

function scan(args = []) {
  try {
    return { status: 0, out: execFileSync(process.execPath, [SCAN, ...args], { encoding: 'utf8' }) };
  } catch (e) { return { status: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}

/* ── every interpolation in the site has been read ── */
{
  const r = scan(['--check']);
  t('every HTML interpolation is reviewed', r.status === 0, r.out.slice(-800));
  t('the scan is looking at a real amount of code', /\b1[0-9]{2,} interpolations scanned/.test(r.out), r.out.slice(-200));
}

/* ── the allow-list is counted, and every entry says why ── */
{
  const allow = JSON.parse(readFileSync(join(ROOT, 'scripts', 'html_sinks_allow.json'), 'utf8'));
  const keys = Object.keys(allow);
  t('the allow-list is not empty', keys.length > 100, keys.length + ' entries');
  const uncounted = keys.filter((k) => typeof allow[k] !== 'object' || typeof allow[k].n !== 'number');
  t('every entry carries an occurrence count', uncounted.length === 0, uncounted.slice(0, 3).join(', '));
  const unexplained = keys.filter((k) => !allow[k].why || allow[k].why.length < 20);
  t('every entry carries a reason', unexplained.length === 0, unexplained.slice(0, 3).join(', '));
  /* An entry for sinks that no longer exist is dead weight that would silently
     cover a future one, so it should be noticed rather than left. */
  const stale = keys.filter((k) => allow[k].n === 0);
  t('no entry covers zero occurrences', stale.length === 0, stale.slice(0, 5).join(', '));
}

/* ── a second copy of a reviewed expression is a new, unreviewed sink ── */
{
  const victim = join(ROOT, 'tools', 'lib-media.js');
  const original = readFileSync(victim, 'utf8');
  const marker = "'    <path>' + xmlEsc(e.path) + '</path>',";
  t('the fixture line is still there', original.includes(marker));
  try {
    writeFileSync(victim, original.replace(marker,
      marker + "\n        '    <dup>' + xmlEsc(e.path) + '</dup>',"));
    const r = scan(['--check']);
    t('a duplicated sink fails the check', r.status !== 0, 'exit ' + r.status);
    t('the failure names the file and line',
      /tools\/lib-media\.js/.test(r.out) && /xmlEsc\(e\.path\)/.test(r.out), r.out.slice(-400));
  } finally {
    writeFileSync(victim, original);
  }
  t('the fixture file was restored', readFileSync(victim, 'utf8') === original);
  t('the check passes again once restored', scan(['--check']).status === 0);
}

console.log(`test_html_sinks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
