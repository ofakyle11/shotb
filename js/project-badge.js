/* CINAMATE — active-project lock badge.
 *
 * The Projects vault keeps one production live across the whole site;
 * this badge pins its name into every module's topbar and, if another
 * tab switches projects, locks this page behind a reload prompt so two
 * productions can never bleed into each other. Original code.
 */
(function () {
  'use strict';
  var META = 'CIN_Projects_v1';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function activeName() {
    try {
      var m = JSON.parse(localStorage.getItem(META) || 'null');
      return (m && m.active) || 'Project 1';
    } catch (e) { return 'Project 1'; }
  }
  var startActive = activeName();

  function mount() {
    var tb = document.querySelector('.topbar');
    if (!tb || document.getElementById('cinProjBadge')) return;
    var a = document.createElement('a');
    a.id = 'cinProjBadge';
    a.href = '/projects/';
    a.title = 'Active project — every module reads and writes this production. Click to switch, back up or start another.';
    a.style.cssText = 'margin-left:10px;font-size:10px;font-weight:700;letter-spacing:.04em;color:#7FA8CC;text-decoration:none;border:1px solid rgba(139,163,184,.28);border-radius:6px;padding:3px 9px;white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis;align-self:center';
    a.textContent = '▣ ' + startActive;
    var spacer = tb.querySelector('.tb-spacer');
    tb.insertBefore(a, spacer || null);
  }

  function overlay(newName) {
    if (document.getElementById('cinProjSwitch')) return;
    var d = document.createElement('div');
    d.id = 'cinProjSwitch';
    d.style.cssText = 'position:fixed;inset:0;background:rgba(6,14,26,.94);z-index:99999;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px';
    d.innerHTML = '<div><div style="font:700 20px Cinzel,serif;color:#E8EEF2;margin-bottom:10px">Project switched</div>' +
      '<div style="font:13px Inter,sans-serif;color:#A0B4C8;max-width:440px;line-height:1.65">This browser is now working on <b style="color:#7FA8CC">' + esc(newName) + '</b>. ' +
      'This page was opened under a different production — reload it so nothing crosses between projects.</div>' +
      '<button id="cinProjReload" style="margin-top:16px;background:#5B8DB8;border:none;color:#0A1628;font-weight:700;border-radius:8px;padding:10px 22px;cursor:pointer;font-size:13px">Reload this page</button></div>';
    document.body.appendChild(d);
    document.getElementById('cinProjReload').onclick = function () { location.reload(); };
  }

  window.addEventListener('storage', function (ev) {
    if (ev.key !== META) return;
    var n = activeName();
    if (n !== startActive) {
      var b = document.getElementById('cinProjBadge');
      if (b) b.textContent = '▣ ' + n;
      overlay(n);
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
