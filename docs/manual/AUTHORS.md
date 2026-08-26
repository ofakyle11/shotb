# Manual chapter authors — the brief

Read this before writing your chapter. `scripts/build_manual.mjs` enforces the
contract below and fails **by name** when a fragment breaks it.

## The fragment contract

You write exactly one file: `docs/manual/ch-NN-slug.html`. Nothing else.
Nineteen other authors are writing concurrently — touching any other file
collides with them and your work is discarded.

- **Body content only.** No `<html>`, `<head>`, `<body>`, `<style>`, `<script>`.
- It **opens** with `<h1 class="ch">Your Chapter Title</h1>`.
- **Immediately after that heading:** `<span class="mk">@@CHnn@@</span>`, with
  `nn` matching your chapter number.

  That marker is how the contents page finds your page number. It is styled
  tiny-and-white so it stays in the **PDF text layer**. Do **not** hide it with
  `display:none`, `visibility:hidden`, or a zero height — chromium then emits no
  glyph, and pass 1 of the build fails saying exactly that.

- Classes available, defined in `manual.css` — read it:
  `.lede` (italic opening paragraph) · `.note` (caution box) · `.path` and
  `<code>` (paths, keys, identifiers) · `<pre>` · `<table>`/`<th>`/`<td>` ·
  `<h2>`, `<h3>` · `<ul>`/`<ol>`.
- Written for **A4 print**. No screenshots, no links, no colour-dependent
  meaning — this is read on paper.

## How to write it

**You are documenting from source, not from a running application.** You cannot
click anything. Describe what the code demonstrably does. Where you cannot
establish a behaviour by reading, say so in a `.note` — do not invent it. A
manual that quietly guesses is worse than one that admits a gap, because the
reader cannot tell which sentences to trust.

- **Be specific.** Name the real file, the real storage key, the real limit.
  "Configure your settings" documents nothing.
- **Never invent** a price, a URL, a phone number, an owner name you did not
  read, or any password — even one you find in source.
- **Never rename an `SB_*` or `CIN_*` key**, even in prose. An operator will
  search for the exact string.
- **Destructive operations get a `.note`.** Anything that clears, overwrites or
  deletes must be flagged where the reader meets it, not in an appendix.
- **Voice** (`docs/audit/BRAND.md` §5): sophisticated, never peppy. "Begin your
  next production", not "Get started!". No exclamation marks in chrome or
  headings. No "Oops". No "Awesome".

## The standing disclaimer

Every chapter carries this once, near the top, in a `.note`, **in your own
words** — not copy-pasted identically across twenty chapters:

> This manual was written by reading the source. The platform is under active
> development, and where the manual and the software disagree, the software is
> what runs.

## Verify before reporting

```
node scripts/build_manual.mjs
```

It builds whatever chapters exist, so a missing neighbour is fine. If it fails
on **another author's** file, that is not yours to fix: say so in your report
and confirm your own fragment is well-formed.

**Do not commit.** The director verifies and commits.

## Report

At most 8 lines: what you covered, what you could not establish from source and
therefore flagged, and the build result.
