# CINAMATE — Brand Specification (Blue Patina Edition)

Source: `CINAMATE_Brand_Identity_Toolkit_Blue_Patina_Edition_2.pdf`, supplied by
the owner 2026-08-26. **This file is the specification for every UI order.** Do
not invent a palette, a type scale or a tone of voice; cite this.

Implementation status as of commit `7b01cde` is recorded inline. Where the code
and the kit disagreed, the kit won unless a deviation is listed in §8.

---

## 1 · Palette

Every colour below is a token in **both** `css/tokens.css` and `css/theme.css`.
Those two files hand-mirror their section 01 and the mirror is verified
byte-identical — **if you add a token to one, add it to the other**, or the
landing page (which loads `theme.css` from the public CDN) and the 28 gated
module pages drift apart.

### Primary

| Kit name | Hex | Token | Role |
|---|---|---|---|
| Deep Navy | `#0A1628` | `--void` | page background |
| Blue Patina | `#8BA3B8` | `--violet` \* | secondary / informational |
| Dark Lens | `#1A2F4A` | `--surface-2` | raised panels, inputs, hover |

### Secondary

| Kit name | Hex | Token | Role |
|---|---|---|---|
| Metallic Highlight | `#C0D0E0` | `--patina-hi` | rims, hover lift, key line |
| Mid Blue | `#4A6B82` | `--blue-mid` | gradient terminus, muted fills |
| Soft Film White | `#E8EEF2` | `--text-hi` | primary text |

`--patina-hi` and `--blue-mid` did not exist in the tree before `7b01cde`.
They are new and largely unused — reach for them rather than mixing a one-off.

### Accent — use sparingly

| Kit name | Hex | Token | Role |
|---|---|---|---|
| Heritage Gold | `#C9A86C` | `--magenta` \* | premium CTAs, tax-credit wins, celebratory moments |

**Sparingly is a real constraint.** Gold is for the moment a production gets
money, not for ordinary chrome. If a whole panel is gold, it is wrong.

### Semantic

| Role | Hex | Token |
|---|---|---|
| Primary Action | `#5B8DB8` | `--cyan` \*, aliased as `--gold` \*\* |
| Success | `#4A8B7A` | `--ok` |
| Warning | `#C9A06C` | `--warn` |
| Error | `#A65D5D` | `--error` |
| Text Primary | `#E8EEF2` | `--text-hi` |
| Text Secondary | `#A0B4C8` | `--text-mid` |

\* **The accent token names are historical and wrong.** `--cyan` is a slate
blue, `--violet` a grey-blue, `--magenta` a champagne brass. The values are
right. Renaming touches ~400 call sites for zero visual gain — **do not do it
as a side effect of another order.**

\*\* `--gold: var(--cyan)` — **`--gold` paints Action Blue `#5B8DB8`, not
gold.** All ~394 uses are correct as rendered. A Phase-1 report claiming the
module pages over-use gold was measuring the name, not the colour.

### Gradient

The kit specifies exactly one: **Deep Navy → Mid Blue**, shipped as
`--grad-brand`. It is the only gradient permitted to fill a surface.
`--grad-holo` is a *stroke* recipe — thin strokes, text fills, 1px borders —
and stays one.

### Prohibited

- **No pure black or pure white as a dominant surface.** Use `--void` and
  `--text-hi`. (`--black`/`--white` exist solely for `@media print`.)
- No neon or high-chroma accents. `#eab308` was removed for this reason.
- No cartoonish illustration, no generic startup illustration, no sterile
  white tech look.
- **Exception — third-party identity colours are out of scope.** The provider
  legend in `app.html` carries OpenAI green, WaveSpeed sky and Grok violet.
  Its job is telling those services apart, and a brand kit does not govern a
  partner's colour. Do not repaint them.

---

## 2 · Typography

| Role | Face | Token | Loaded weights |
|---|---|---|---|
| Display (all-caps) | **Cinzel** | `--font-serif` / `--display` | **400, 700 only** |
| Body / UI / data | **Inter** | `--font-sans` / `--body` | 400, 500, 600, 700 |
| Numerals, ids, readouts | IBM Plex Mono | `--font-code` / `--mono` | 400, 500, 600 |
| Tagline only | Playfair / Cormorant *Italic* | — | landing only |

**Cinzel has no weight above 700.** `font-weight:800` on `var(--display)`
does not produce a heavier Cinzel — the browser synthesizes a smeared fake
bold from the 700 master. Ten such rules were fixed in `7b01cde`. Never
reintroduce one; if a heading needs more presence, use size or tracking.

**Display tracking is positive: +0.04em to +0.08em**, all-caps. Five rules
had *negative* tracking and were fixed. Negative tracking on Cinzel is always
a defect.

**Never pair two serifs.** Cinzel + Inter is the pairing. Playfair/Cormorant
italic appears only as a tagline on the landing page and never beside Cinzel
in the app.

Both public-shell and app stacks exist and differ (`--font-display` is Inter
on the public shell; `--display` is Cinzel in the app). Reconciling them
changes computed `font-family` on the landing page and is a **separate
order** — do not fold it into a territory.

---

## 3 · Surfaces (SaaS interface spec)

| Tier | Hex | Token |
|---|---|---|
| Page background | `#0A1628` | `--void` |
| App chrome (topbar, rails, panels) | `#0F1F33` | `--surface-0` |
| Cards / surfaces | `#12253A` | `--surface-1` |
| Raised / inputs / hover | `#1A2F4A` | `--surface-2` |

Interactive elements are **Action Blue and Patina**. Dark mode is the default
and the only mode. Contrast must meet **WCAG AA**; `--text-faint` `#6A7E94` is
the lowest readable tier at 5.05:1 on `--void` — nothing dimmer.

---

## 4 · Logo

- Full logo minimum **120px**; icon minimum **32px**.
- Left nav carries the **aperture icon + wordmark**.
- Module icons follow **Art Deco geometry** — the same blade language as the
  aperture, not a generic icon set.
- Assets: `assets/logo.svg`, `assets/logo-mark.svg`.
- **Known deviation:** the landing footer mark is 22px. See §8.

---

## 5 · Voice

Sophisticated, never peppy. The kit's own example:

> "Begin your next production" — **not** "Get started!"

This governs empty states, onboarding, toasts and button labels. No
exclamation marks in chrome. No "Oops". No "Awesome".

---

## 6 · Where the tokens are loaded

```
css/tokens.css      ← @import at top of timeline/timeline.css   (every module page)
                    ← @import at top of css/cinamate-ui.css     (every module page)
css/theme.css       ← <link> on the 3 public-shell pages (landing, login, 404)
```

`theme.css` duplicates section 01 rather than importing it because the deploy
partitions `theme.css` onto the public CDN while `tokens.css` moves inside the
gate — a public sheet importing a gated one would be answered with a redirect
and the landing page would render untokenised for every anonymous visitor.

`app.html` declares its **own** `:root` block and does not read either file.
Any palette change must be applied there separately until the shell is
reconciled (a Phase 3 T2 decision).

---

## 7 · Verification

A UI order is not done until:

```
node scripts/run_all_tests.mjs          # 62/62
node scripts/scan_html_sinks.mjs --check # 0 unreviewed
node scripts/smoke_pages.mjs            # 32/32   (html/css/js changed)
node scripts/deploy_cinamate.mjs --build-only   # public shell MUST stay 31
```

A change in the `public shell: N` count means the deploy partition moved and
something is about to ship to the wrong side of the gate. Stop and report.

Grep checks that must return zero:

```sh
# fake-bold Cinzel
grep -rnE 'var\(--display\)[^}]*font-weight:\s*(800|900)' --include=*.css --include=*.html .
# negative tracking on display type
grep -rno 'var(--display)[^}]*letter-spacing:-[0-9.]*em' --include=*.css --include=*.html .
# off-brand palette
grep -rn 'eab308\|a78bfa\|E8EEF4' --include=*.css --include=*.html .
```

---

## 8 · Accepted deviations

| Item | Kit says | Code does | Why it stands |
|---|---|---|---|
| Landing footer aperture mark | icon min 32px | 22px | A documented reduction lockup: an in-file comment cites an earlier spec (at ≤24px render layers 2+3 only, single colour) and the blade geometry is simplified for that size. Enlarging discards a considered design to satisfy a minimum written for the full mark. Owner notified; reversible on request. |
| Provider legend swatches | no neon accents | OpenAI green, WaveSpeed sky, Grok violet | Third-party product identity, not Cinamate chrome. See §1 Prohibited. |
| Accent token names | — | `--cyan`/`--violet`/`--magenta`/`--gold` misname their values | Values are correct; renaming is ~400 call sites for zero visual change. Deliberate debt, documented here and in `css/tokens.css`. |

Anything not in this table is a defect, not a deviation.
