/* Shotbreak — cloud project sync (Firebase Storage).
   Projects auto-back-up to users/{uid}/projects/{slug}.json a few seconds
   after each change, and the newest backup is offered on login. Storage is
   used (not Firestore) because it is already enabled for this Firebase
   project and already carries the reference images. */
window.SBSync = (function () {
  'use strict';

  var timer = null;
  var lastContent = '';
  var listeners = [];

  function ready() {
    return !!(window.firebase && firebase.apps && firebase.apps.length && typeof firebase.storage === 'function');
  }
  function uid() {
    try { return firebase.auth().currentUser ? firebase.auth().currentUser.uid : null; } catch (e) { return null; }
  }
  function slug(name) {
    return String(name || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
  }
  function onStatus(fn) { listeners.push(fn); }
  function setStatus(s, detail) {
    listeners.forEach(function (fn) { try { fn(s, detail); } catch (e) {} });
  }

  /* Content WITHOUT savedAt, so unchanged projects don't re-upload. */
  function contentJson(state) {
    return JSON.stringify({
      projectName: state.projectName, clips: state.clips, characters: state.characters,
      locationBible: state.locationBible, propBible: state.propBible, continuityRules: state.continuityRules,
      global: state.global, assembly: state.assembly, parseResult: state.parseResult, scriptText: state.scriptText
    });
  }

  async function backupNow(state) {
    if (!ready() || !uid()) return null;
    var content = contentJson(state);
    if (content === lastContent) return null;
    if (content.length > 25 * 1024 * 1024) { setStatus('error', new Error('Project too large to back up')); return null; }
    var body = '{"savedAt":' + Date.now() + ',' + content.slice(1);
    var path = 'users/' + uid() + '/projects/' + slug(state.projectName) + '.json';
    setStatus('saving');
    try {
      await firebase.storage().ref().child(path).putString(body, 'raw', {
        contentType: 'application/json',
        cacheControl: 'no-store'
      });
      lastContent = content;
      setStatus('synced', Date.now());
      return path;
    } catch (e) {
      setStatus('error', e);
      return null;
    }
  }

  /* Debounced: call on every local save; uploads settle 4s after the last change. */
  function queueBackup(state) {
    if (!ready() || !uid()) return;
    clearTimeout(timer);
    timer = setTimeout(function () { backupNow(state); }, 4000);
  }

  /* Mark current state as already-synced (e.g. right after restoring FROM cloud). */
  function markClean(state) { lastContent = contentJson(state); }

  async function list() {
    if (!ready() || !uid()) throw new Error('Sign in first');
    var dir = firebase.storage().ref().child('users/' + uid() + '/projects');
    var res = await dir.listAll();
    var items = await Promise.all(res.items.filter(function (it) { return /\.json$/.test(it.name); }).map(async function (it) {
      var meta = await it.getMetadata();
      return { name: it.name.replace(/\.json$/, ''), path: it.fullPath, updated: meta.updated, size: meta.size };
    }));
    items.sort(function (a, b) { return new Date(b.updated) - new Date(a.updated); });
    return items;
  }

  async function fetchProject(path) {
    var url = await firebase.storage().ref().child(path).getDownloadURL();
    var r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('Cloud download failed (' + r.status + ')');
    return r.json();
  }

  /* Newest backup across all this user's projects, data included. */
  async function latest() {
    var items = await list();
    if (!items.length) return null;
    var data = await fetchProject(items[0].path);
    return { meta: items[0], data: data };
  }

  return { ready: ready, slug: slug, queueBackup: queueBackup, backupNow: backupNow, markClean: markClean, list: list, fetchProject: fetchProject, latest: latest, onStatus: onStatus };
})();
