/* CINAMATE — the shared schema-driven table (register) component.
 *
 * WHY THIS FILE EXISTS
 *
 * This engine has always been the right answer to "a table of rows the owner
 * edits, backed by an SB_* store, exported to CSV". It was also buried in
 * tools/tools-core.js, where exactly ONE page could reach it, while fifteen
 * other table-bearing pages hand-rolled `<table>` markup with inline `oninput`
 * wiring — fifteen separate escaping decisions, fifteen separate CSV
 * exporters, fifteen places for the formula-injection guard to be forgotten.
 * So it moved here, to js/, where every page can load it.
 *
 * WHAT CHANGED IN THE MOVE (three verified warts, fixed)
 *   · `type:'textarea'` rendered a plain single-line `<input>`. It renders a
 *     real <textarea> now, so a notes column stops truncating visually.
 *   · `type:'money'` and `type:'number'` both fell through to `type="text"`,
 *     so a numeric column got no numeric keypad on a phone and no browser
 *     validation. Both render `<input type="number">` now — money with
 *     step="0.01" because invoices have cents in them.
 *   · `flags` was documented in the schema and half-implemented in the render
 *     loop: it called `s.flags(row)` and then appended the empty string. It
 *     draws chips now, in a column of its own, and the header and the
 *     empty-state colspan follow.
 * `toCsv`'s CSV-injection guard is carried over unchanged and is exercised by
 * scripts/test_csv_injection.mjs and scripts/test_ui_chrome.mjs.
 *
 * WHAT IS *NOT* IN SCOPE FOR THIS COMPONENT
 * A Register is a FLAT register: every cell is either the stored value or a
 * chip derived from it. Tables that compute per-row money from another store,
 * carry a per-row action button, or join two stores — /vfx/, /music/, /post/,
 * /taxcredit/ — are not Registers and must not be forced into one. See
 * docs/audit/ADOPTION-CHROME.md.
 *
 * SECURITY
 * This file builds markup from data, so it is an HTML sink: every value below
 * goes through esc(), a class name through chipCls(), and every CSV cell
 * through csvSafe(). There are no URLs in a register cell, so CinUrl is not
 * needed here — if a URL column is ever added, it must go through
 * CinUrl.safe() and this file must then require js/safe-url.js.
 *
 * LOAD ORDER
 *   js/ui-chrome.js (optional — supplies the shared toast)  →  js/ui-table.js
 *
 * SCHEMA
 *   { key,                      the SB_* localStorage key (required)
 *     hint?,                    one line of help, shown in the toolbar
 *     fields: [{ id, label, type?, options?, width? }],
 *                               type: text | money | number | date | select | textarea
 *     summary?(rows) -> html,   already-escaped summary line
 *     blank?() -> row,          the shape a new row starts as
 *     expiryField?,             field id whose date drives the amber/red chip
 *     flags?(row) -> {cls,label} | [{cls,label}] | null }
 *
 * All original code, written for Cinamate.
 */
(function (root) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  /* ── storage ─────────────────────────────────────────────────── */
  function load(key, fallback) {
    try { return JSON.parse((root.localStorage && localStorage.getItem(key)) || 'null') || fallback; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { root.localStorage && localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  var _uid = 0;
  function uid() { return 't' + (++_uid) + '_' + Math.random().toString(36).slice(2, 8); }

  /* Escapes all five markup-significant characters — the apostrophe matters
     because a value dropped into a single-quoted attribute can break out. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) {
    n = Math.round(Number(n) || 0);
    return '$' + n.toLocaleString('en-US');
  }
  function num(v) { var n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d)) return null;
    return Math.round((d - new Date()) / 86400000);
  }

  /* The one toast, from js/ui-chrome.js. A page that loads the table without
     the chrome still works — it just says nothing when the CSV lands. */
  function say(msg) { if (root.CChrome) root.CChrome.toast(msg); }

  /* A chip's class comes from a schema, not from a user, but it lands unquoted
     inside a class attribute — so it is filtered to what a class name may
     contain rather than merely escaped. */
  function chipCls(v) { return String(v == null ? '' : v).replace(/[^\w\s-]/g, ''); }

  /* ── register engine ─────────────────────────────────────────── */
  function Register(schema) {
    this.schema = schema;
    this.rows = load(schema.key, []);
  }
  Register.prototype.persist = function () { save(this.schema.key, this.rows); };
  Register.prototype.add = function (row) {
    row = row || {};
    row.id = row.id || uid();
    this.rows.unshift(row);
    this.persist();
    return row;
  };
  Register.prototype.remove = function (id) {
    this.rows = this.rows.filter(function (r) { return r.id !== id; });
    this.persist();
  };
  Register.prototype.update = function (id, field, value) {
    var r = this.rows.find(function (x) { return x.id === id; });
    if (r) { r[field] = value; this.persist(); }
  };
  /* A spreadsheet treats a cell beginning = + - @ (or a lone tab/CR) as a
     formula, so a value typed into a production here can execute when a
     colleague opens the export. Prefixing an apostrophe keeps the text visible
     and inert; Excel and Sheets both strip it on display. */
  function csvSafe(v) {
    var s = String(v == null ? '' : v);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }

  Register.prototype.toCsv = function () {
    var f = this.schema.fields;
    var lines = [f.map(function (x) { return '"' + csvSafe(x.label).replace(/"/g, '""') + '"'; }).join(',')];
    this.rows.forEach(function (r) {
      lines.push(f.map(function (x) {
        return '"' + csvSafe(r[x.id]).replace(/"/g, '""') + '"';
      }).join(','));
    });
    return lines.join('\n');
  };

  /* One cell's input. The whole point of the type map is that a schema says
     what a column IS and this decides how it is edited — the old version threw
     three of the six declared types away and rendered a text box. */
  function cellInput(f, v) {
    if (f.type === 'select') {
      return '<select class="uc-sel tk-in" data-f="' + esc(f.id) + '">' + (f.options || []).map(function (o) {
        return '<option' + (String(v) === o ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('') + '</select>';
    }
    if (f.type === 'textarea') {
      return '<textarea class="tk-in tk-area" data-f="' + esc(f.id) + '" rows="2">' + esc(v) + '</textarea>';
    }
    var kind = f.type === 'date' ? 'date'
      : (f.type === 'money' || f.type === 'number') ? 'number' : 'text';
    /* Money carries cents; a bare number column may be days or eighths, so it
       accepts any step rather than pretending to be an integer. */
    var extra = f.type === 'money' ? ' step="0.01" inputmode="decimal"'
      : f.type === 'number' ? ' step="any" inputmode="decimal"' : '';
    return '<input class="tk-in' + (kind === 'number' ? ' tk-num' : '') +
      '" data-f="' + esc(f.id) + '" type="' + kind + '"' + extra +
      ' value="' + esc(v) + '">';
  }

  /* The flags column. `flags(row)` may return one chip, a list of chips, or
     nothing; anything falsy in the list is skipped. */
  function flagCell(schema, row) {
    var fl = schema.flags(row);
    var list = fl == null ? [] : (Object.prototype.toString.call(fl) === '[object Array]' ? fl : [fl]);
    var h = '';
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (!x || x.label == null) continue;
      h += '<span class="tk-chip ' + chipCls(x.cls) + '">' + esc(x.label) + '</span>';
    }
    return '<td class="tk-flags">' + h + '</td>';
  }

  /* The whole table as a string, with no DOM anywhere in it. Kept separate
     from render() so scripts/test_ui_chrome.mjs can assert on the markup in
     node — the three warts fixed in this move were all in here, and a bug you
     can only see by opening a browser is a bug nobody sees. */
  Register.prototype.html = function () {
    var s = this.schema;
    var cols = s.fields.length + (s.flags ? 2 : 1);
    var h = '<div class="tk-bar"><button type="button" class="tb-btn gold" data-act="add">+ Add</button>' +
      '<button type="button" class="tb-btn" data-act="csv">Export CSV</button>' +
      (s.hint ? '<span class="ps-hint">' + esc(s.hint) + '</span>' : '') + '</div>';
    if (s.summary) h += '<div class="tk-summary">' + s.summary(this.rows) + '</div>';
    h += '<div class="bud-tablewrap"><table class="bud-table tk-table"><thead><tr>';
    s.fields.forEach(function (f) { h += '<th' + (f.width ? ' style="width:' + esc(f.width) + '"' : '') + '>' + esc(f.label) + '</th>'; });
    if (s.flags) h += '<th></th>';
    h += '<th></th></tr></thead><tbody>';
    if (!this.rows.length) h += '<tr><td colspan="' + cols + '" class="tk-empty">Nothing here yet — add the first entry.</td></tr>';
    this.rows.forEach(function (r) {
      h += '<tr data-id="' + esc(r.id) + '">';
      s.fields.forEach(function (f) {
        var v = r[f.id] == null ? '' : r[f.id];
        h += '<td>' + cellInput(f, v);
        if (f.type === 'date' && s.expiryField === f.id) {
          var d = daysUntil(v);
          if (d != null && d < 30) h += '<span class="tk-chip ' + (d < 0 ? 'bad' : 'warn') + '">' + esc(d < 0 ? 'EXPIRED' : d + 'd') + '</span>';
        }
        h += '</td>';
      });
      if (s.flags) h += flagCell(s, r);
      h += '<td><button type="button" class="tb-btn tk-del" title="Delete">✕</button></td></tr>';
    });
    h += '</tbody></table></div>';
    return h;
  };

  Register.prototype.render = function (mount) {
    var self = this, s = this.schema;
    var host = typeof mount === 'string' ? $(mount) : mount;
    if (!host) return;
    host.innerHTML = this.html();

    host.querySelector('[data-act=add]').onclick = function () { self.add(s.blank ? s.blank() : {}); self.render(host); };
    host.querySelector('[data-act=csv]').onclick = function () {
      var blob = new Blob([self.toCsv()], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = s.key.replace(/^SB_/, '').replace(/_v\d+$/, '') + '.csv';
      a.click();
      say('CSV exported');
    };
    Array.prototype.forEach.call(host.querySelectorAll('.tk-in'), function (inp) {
      inp.onchange = function () {
        var id = inp.closest('tr').getAttribute('data-id');
        self.update(id, inp.getAttribute('data-f'), inp.value);
        /* A summary, an expiry chip and a flag are all derived from the row, so
           any of them means the table has to be redrawn to stay true. */
        if (s.summary || s.expiryField || s.flags) self.render(host);
      };
    });
    Array.prototype.forEach.call(host.querySelectorAll('.tk-del'), function (btn) {
      btn.onclick = function () {
        self.remove(btn.closest('tr').getAttribute('data-id'));
        self.render(host);
      };
    });
  };

  root.CTable = {
    $: $, load: load, save: save, uid: uid, esc: esc, fmtMoney: fmtMoney,
    num: num, today: today, daysUntil: daysUntil, csvSafe: csvSafe,
    cellInput: cellInput, chipCls: chipCls, Register: Register
  };
})(typeof window !== 'undefined' ? window : globalThis);
