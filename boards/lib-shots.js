/* CINAMATE Boards — shot-list / storyboard engine (pure, no DOM).
 *
 * Scenes come from the Studio timeline (or Writer beats); each scene
 * carries an ordered shot list (size / angle / movement / lens / frame
 * image / seconds). Coverage suggestions follow standard shooting
 * convention: a master plus singles on the speaking cast plus an
 * insert. The animatic plan flattens boards into timed frames for the
 * MP4 writer. All original code, written for Cinamate.
 */
(function (root) {
  'use strict';

  var SIZES = ['EWS', 'WS', 'MS', 'MCU', 'CU', 'ECU', 'OTS', 'POV', 'INSERT'];
  var ANGLES = ['Eye level', 'High', 'Low', 'Dutch', 'Overhead', 'Ground'];
  var MOVES = ['Static', 'Pan', 'Tilt', 'Push in', 'Pull out', 'Track', 'Handheld', 'Crane', 'Zoom'];

  function blank() { return { scenes: [] }; }

  /* Seed scenes from what the platform already knows.
   * timeline: SB_Timeline_v1 (clips = parsed scenes/shots)
   * writer:   SB_Writer_v1  (treatment beats) */
  function seedScenes(timeline, writer, mkId) {
    mkId = mkId || function (i) { return 'sc' + (i + 1); };
    var clips = (timeline && Array.isArray(timeline.clips)) ? timeline.clips : [];
    if (clips.length) {
      return clips.map(function (c, i) {
        return { id: mkId(i), slug: 'SC' + String(c.num || i + 1).padStart(2, '0') + ' — ' + (c.label || 'Scene'), desc: c.prompt || '', shots: [] };
      });
    }
    var beats = (writer && Array.isArray(writer.scenes)) ? writer.scenes : [];
    return beats.map(function (s, i) {
      return { id: mkId(i), slug: s.slug || 'SCENE ' + (i + 1), desc: (s.body || '').slice(0, 200), shots: [] };
    });
  }

  function blankShot(id) {
    return { id: id, size: 'WS', angle: 'Eye level', move: 'Static', lensMm: 35, desc: '', img: '', dur: 2 };
  }

  /* master + a single on each named character (max 4) + an insert */
  function suggestCoverage(scene, characters, mkId) {
    mkId = mkId || function (i) { return scene.id + '_s' + i; };
    var shots = [];
    var n = 0;
    var master = blankShot(mkId(n++));
    master.size = 'WS'; master.desc = 'Master — full scene';
    shots.push(master);
    (characters || []).slice(0, 4).forEach(function (name) {
      var s = blankShot(mkId(n++));
      s.size = 'CU'; s.lensMm = 50; s.desc = 'Single — ' + name;
      shots.push(s);
    });
    var ins = blankShot(mkId(n++));
    ins.size = 'INSERT'; ins.lensMm = 85; ins.desc = 'Insert — key prop / detail';
    shots.push(ins);
    return shots;
  }

  function shotCount(project) {
    return (project.scenes || []).reduce(function (a, s) { return a + (s.shots || []).length; }, 0);
  }

  function totalDur(project) {
    var d = 0;
    (project.scenes || []).forEach(function (s) {
      (s.shots || []).forEach(function (sh) { d += (+sh.dur || 2); });
    });
    return d;
  }

  /* flatten into timed animatic frames; only shots with a frame image
   * unless includeEmpty (empty frames render as slates) */
  function animaticPlan(project, includeEmpty) {
    var frames = [];
    (project.scenes || []).forEach(function (s) {
      (s.shots || []).forEach(function (sh, i) {
        if (!sh.img && !includeEmpty) return;
        frames.push({
          img: sh.img || '',
          dur: Math.max(0.5, +sh.dur || 2),
          label: s.slug + ' · ' + sh.size + ' ' + (i + 1),
          desc: sh.desc || ''
        });
      });
    });
    return frames;
  }

  /* shot-list rows for CSV export */
  function toCsvRows(project) {
    var rows = [['Scene', 'Shot', 'Size', 'Angle', 'Move', 'Lens (mm)', 'Secs', 'Description']];
    (project.scenes || []).forEach(function (s) {
      (s.shots || []).forEach(function (sh, i) {
        rows.push([s.slug, String(i + 1), sh.size, sh.angle, sh.move, String(sh.lensMm || ''), String(sh.dur || ''), sh.desc || '']);
      });
    });
    return rows;
  }
  function toCsv(project) {
    return toCsvRows(project).map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
  }

  root.CShots = {
    SIZES: SIZES, ANGLES: ANGLES, MOVES: MOVES,
    blank: blank, blankShot: blankShot,
    seedScenes: seedScenes, suggestCoverage: suggestCoverage,
    shotCount: shotCount, totalDur: totalDur,
    animaticPlan: animaticPlan, toCsv: toCsv
  };
})(typeof window !== 'undefined' ? window : globalThis);
