/* CINAMATE — one place that decides whether a URL is safe to put in a page.
 *
 * Every href and src in this app was built with esc(), which HTML-escapes the
 * value. That is the right tool for text and the wrong tool for a URL:
 * "javascript:alert(1)" contains no < > " or ', so escaping passes it through
 * unchanged, and the app's CSP carries 'unsafe-inline', which is exactly the
 * condition under which a browser will run a javascript: URL. Clicking a link
 * built from a hostile value therefore executed script in the owner's session.
 *
 * The vault scrubber blanks bad schemes on the way out of an archive, but it
 * only ever sees archives. A reply from TMDB, Wikidata or the props research
 * service, or anything a module writes to localStorage itself, reaches these
 * sinks having passed through no scrubber at all. So the check belongs at the
 * sink, where every path converges.
 *
 * Usage:  href="' + CinUrl.safe(value) + '"
 *         <img src="${CinUrl.safe(photo)}">
 * An unsafe or unrecognised value becomes '' — a link to nowhere, which is
 * the correct failure for something we could not vouch for.
 *
 * Original code, written for Cinamate.
 */
(function (root) {
  'use strict';

  /* Browsers ignore whitespace and control characters while working out a
     URL's scheme, so "java\tscript:alert(1)" and "  javascript:alert(1)" both
     run. Rather than trying to write a pattern that tolerates them in every
     position, they are removed first and the scheme is tested against what is
     left. Tab, newline and NUL between the letters of "javascript" is the
     classic bypass of a naive /^javascript:/ check. */
  /* A browser treats a backslash as a slash while parsing a special-scheme
     URL, so "/\evil.tld/x" resolves to https://evil.tld/x exactly as
     "//evil.tld/x" does. The (?!/) guard in OK_SHAPE only ever saw the
     forward slash, so the one form was blocked and the other sailed past.
     No URL this app emits contains a backslash, so refuse them outright
     rather than trying to enumerate where they are harmful. */
  function hasBackslash(v) { return String(v).indexOf('\\') !== -1; }

  function bare(v) {
    return v.replace(/[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]/g, '');
  }
  /* `blob` is deliberately absent: OK_SHAPE below admits only blob:https://,
     which is the object-URL form the editor and the bridge produce, and
     anything else beginning blob: fails that allow-list anyway. Listing it
     here would reject the app's own media. */
  var BAD_SCHEME = /^(javascript|vbscript|livescript|mocha|file|about|data|filesystem|view-source|jar|chrome|resource):/i;

  /* Shapes the app itself produces, and nothing else. An allow-list rather
     than a deny-list: a scheme nobody has thought of yet is refused. The two
     data: forms below are checked here, after the blanket data: refusal
     above, so only base64 image and video payloads get through. */
  var OK_SHAPE = new RegExp(
    '^(' +
      'https?://[^\\s]+' +
      '|/(?!/)' +
      '|\\./|\\.\\./' +
      '|#' +
      '|mailto:[^\\s@]+@[^\\s@]+' +
      '|tel:\\+?[0-9().\\-]{3,}' +
      '|blob:https?://[^\\s]+' +
    ')', 'i');
  var OK_DATA = /^data:(image\/(png|jpe?g|webp|gif|avif)|video\/(mp4|webm));base64,[A-Za-z0-9+/=]+$/i;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Returns an attribute-safe URL, or '' when it is not one we will vouch for. */
  function safe(value) {
    if (value === null || value === undefined) return '';
    var v = String(value).trim();
    if (!v) return '';
    if (hasBackslash(v)) return '';
    var stripped = bare(v);
    if (!stripped) return '';
    if (BAD_SCHEME.test(stripped)) {
      /* base64 media is the one data: form the app legitimately produces */
      if (!OK_DATA.test(stripped)) return '';
      return esc(stripped);
    }
    /* A quote or angle bracket inside a URL is either an encoding mistake or
       an attribute-breakout attempt; neither is a URL we want to emit. */
    if (/["'<>`]/.test(v)) return '';
    if (!OK_SHAPE.test(stripped)) return '';
    /* The authority is not parsed by the shape test above, so
       "https://cinamate-studio.netlify.app@evil.tld/" reads as our host and
       resolves to theirs. Credentials in a URL have no legitimate use here. */
    if (/^https?:/i.test(stripped)) {
      try {
        var u = new URL(stripped);
        if (u.username || u.password) return '';
      } catch (e) { return ''; }
    }
    return esc(v);
  }

  /* True/false form, for code that wants to omit the whole element instead of
     rendering a dead link. */
  function isSafe(value) { return safe(value) !== ''; }

  var api = { safe: safe, isSafe: isSafe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CinUrl = api;
})(typeof window !== 'undefined' ? window : globalThis);
