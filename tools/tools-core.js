/* Cinamate Tools — the bridge to the shared components.
 *
 * WHAT MOVED, AND WHY
 *
 * Everything this file used to define now lives in js/, where every page can
 * reach it rather than only /tools/:
 *
 *   the register engine + storage/format helpers  →  js/ui-table.js  (CTable)
 *   toast()                                       →  js/ui-chrome.js (CChrome)
 *
 * `TCore` is kept as the name the five tools modules already import
 * (`var C = root.TCore, esc = C.esc, fm = C.fmtMoney;`), so not one of them
 * had to change. It is a re-export, not a second copy: there is exactly one
 * implementation of each of these functions in the shipped tree now.
 *
 * WHY THE document.write BELOW
 *
 * tools/index.html is owned by another territory (P3-T2) and could not be
 * edited in this order, so the two <script> tags this file now depends on
 * could not be added to it. tools-registers.js constructs Registers
 * synchronously while the page is still parsing, so a dynamically appended
 * <script> — which is async by definition — would not have run in time; a
 * parser-inserted document.write of a same-origin classic script is the one
 * mechanism that keeps the ordering the page already relies on. It is guarded
 * to the parsing phase, because document.write after parsing wipes the
 * document.
 *
 *   LOAD ORDER (a hard runtime contract, not a convention — the getters below
 *   throw by name if it is broken): the page must load, above this file,
 *     <script src="/js/safe-url.js"></script>   (ui-chrome refuses without it)
 *     <script src="/js/ui-chrome.js"></script>
 *     <script src="/js/ui-table.js"></script>
 *   Both callers do: production/index.html and tools/index.html.
 *
 * All original code, written for Cinamate.
 */
(function (root) {
  'use strict';

  /* The components are loaded by the page, above this file — see the
     load-order contract in the header. The temporary document.write bridge
     that stood here is gone: it injected ui-chrome without safe-url, which
     is what broke /production/, and a script the page cannot see is a
     dependency no check can verify. */

  /* ── re-export ────────────────────────────────────────────────────
   * Lazy, and it stays lazy: a getter that
   * throws by name is also the repo's load-order convention: the failure says
   * which file is missing instead of surfacing as `undefined is not a
   * function` three modules later. */
  var FROM_TABLE = ['$', 'load', 'save', 'uid', 'esc', 'fmtMoney', 'num',
                    'today', 'daysUntil', 'csvSafe', 'Register'];

  var TCore = {};
  FROM_TABLE.forEach(function (name) {
    Object.defineProperty(TCore, name, {
      enumerable: true, configurable: true,
      get: function () {
        if (!root.CTable) {
          throw new Error('tools/tools-core.js requires js/ui-table.js — load <script src="/js/ui-table.js"> before it');
        }
        return root.CTable[name];
      }
    });
  });
  Object.defineProperty(TCore, 'toast', {
    enumerable: true, configurable: true,
    get: function () {
      if (!root.CChrome) {
        throw new Error('tools/tools-core.js requires js/ui-chrome.js — load <script src="/js/ui-chrome.js"> before it');
      }
      return root.CChrome.toast;
    }
  });

  root.TCore = TCore;
})(typeof window !== 'undefined' ? window : globalThis);
