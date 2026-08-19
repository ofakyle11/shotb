/* Cinamate Tools — shared core: storage, formatting, and a schema-driven
 * register (table CRUD) engine that powers the Crew, Festivals, Insurance,
 * Rights, Deals and Distribution tools.
 *
 * All original code, written for Cinamate. Persists to localStorage only —
 * nothing leaves the browser.
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  function toast(msg) {
    var el = $('tToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('on'); }, 2600);
  }

  /* ── register engine ─────────────────────────────────────────────
   * schema: { key, title, hint, fields: [{id,label,type,options?,width?}],
   *           flags?: fn(row) -> {cls,label} chips, summary?: fn(rows) -> html }
   * type: text | money | date | select | textarea | number
   */
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
  Register.prototype.toCsv = function () {
    var f = this.schema.fields;
    var lines = [f.map(function (x) { return '"' + x.label.replace(/"/g, '""') + '"'; }).join(',')];
    this.rows.forEach(function (r) {
      lines.push(f.map(function (x) {
        return '"' + String(r[x.id] == null ? '' : r[x.id]).replace(/"/g, '""') + '"';
      }).join(','));
    });
    return lines.join('\n');
  };

  Register.prototype.render = function (mount) {
    var self = this, s = this.schema;
    var host = typeof mount === 'string' ? $(mount) : mount;
    if (!host) return;
    var h = '<div class="tk-bar"><button class="tb-btn gold" data-act="add">+ Add</button>' +
      '<button class="tb-btn" data-act="csv">Export CSV</button>' +
      (s.hint ? '<span class="ps-hint">' + esc(s.hint) + '</span>' : '') + '</div>';
    if (s.summary) h += '<div class="tk-summary">' + s.summary(this.rows) + '</div>';
    h += '<div class="bud-tablewrap"><table class="bud-table tk-table"><thead><tr>';
    s.fields.forEach(function (f) { h += '<th' + (f.width ? ' style="width:' + f.width + '"' : '') + '>' + esc(f.label) + '</th>'; });
    h += '<th></th></tr></thead><tbody>';
    if (!this.rows.length) h += '<tr><td colspan="' + (s.fields.length + 1) + '" class="tk-empty">Nothing here yet — add the first entry.</td></tr>';
    this.rows.forEach(function (r) {
      h += '<tr data-id="' + r.id + '">';
      s.fields.forEach(function (f) {
        var v = r[f.id] == null ? '' : r[f.id];
        h += '<td>';
        if (f.type === 'select') {
          h += '<select class="uc-sel tk-in" data-f="' + f.id + '">' + (f.options || []).map(function (o) {
            return '<option' + (String(v) === o ? ' selected' : '') + '>' + esc(o) + '</option>';
          }).join('') + '</select>';
        } else if (f.type === 'textarea') {
          h += '<input class="tk-in" data-f="' + f.id + '" value="' + esc(v) + '">';
        } else {
          h += '<input class="tk-in" data-f="' + f.id + '" type="' + (f.type === 'date' ? 'date' : 'text') + '" value="' + esc(v) + '">';
        }
        if (f.type === 'date' && s.expiryField === f.id) {
          var d = daysUntil(v);
          if (d != null && d < 30) h += '<span class="tk-chip ' + (d < 0 ? 'bad' : 'warn') + '">' + (d < 0 ? 'EXPIRED' : d + 'd') + '</span>';
        }
        h += '</td>';
      });
      if (s.flags) {
        var fl = s.flags(r);
        if (fl) h += '';
      }
      h += '<td><button class="tb-btn tk-del" title="Delete">✕</button></td></tr>';
    });
    h += '</tbody></table></div>';
    host.innerHTML = h;

    host.querySelector('[data-act=add]').onclick = function () { self.add(s.blank ? s.blank() : {}); self.render(host); };
    host.querySelector('[data-act=csv]').onclick = function () {
      var blob = new Blob([self.toCsv()], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = s.key.replace(/^SB_/, '').replace(/_v\d+$/, '') + '.csv';
      a.click();
      toast('CSV exported');
    };
    Array.prototype.forEach.call(host.querySelectorAll('.tk-in'), function (inp) {
      inp.onchange = function () {
        var id = inp.closest('tr').getAttribute('data-id');
        self.update(id, inp.getAttribute('data-f'), inp.value);
        if (self.schema.summary || self.schema.expiryField) self.render(host);
      };
    });
    Array.prototype.forEach.call(host.querySelectorAll('.tk-del'), function (btn) {
      btn.onclick = function () {
        self.remove(btn.closest('tr').getAttribute('data-id'));
        self.render(host);
      };
    });
  };

  root.TCore = {
    $: $, load: load, save: save, uid: uid, esc: esc, fmtMoney: fmtMoney,
    num: num, today: today, daysUntil: daysUntil, toast: toast, Register: Register
  };
})(typeof window !== 'undefined' ? window : globalThis);
