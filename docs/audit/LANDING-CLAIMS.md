# Landing-page claims — verified against source

**Read this before editing the landing page.** Every public claim is listed
with the file that substantiates it, or marked removed.

## THE PHASE-1 AUDIT WAS WRONG HERE — DO NOT ACT ON IT

`PHASE1-SYNTHESIS.md` lists a set of landing claims as "verified false". Four
of the five are in fact **true and sourced**. Acting on that synthesis would
have stripped accurate marketing off a public page and replaced correct
numbers with invented ones.

The failure mode was consistent and worth naming: the auditor grepped the
**JavaScript** for a literal, did not find it, and concluded the claim was
fabricated. But `3,708` and `0.848` live in the methodology document the
engine cites in its own header, and the 4-minute sync interval is written
`4 * 60 * 1000`, which no search for `240000` will ever match. **A number
absent from the source you happened to grep is not a fabricated number.**

| Claim | Phase-1 said | Actually |
|---|---|---|
| CALIBRATED ON 3,708 RELEASED FEATURES | false — "not in any JS" | **TRUE** — `producer/sales-forecast.js:9` names the dataset; `docs/SALES_FORECAST.md:29` documents it |
| budget elasticity 0.848 | false — "not in any JS" | **TRUE** — `docs/SALES_FORECAST.md:31`: fitted 0.848, R² 0.40 |
| AUTO-SYNC EVERY 4 MIN | false — "no such interval" | **TRUE** — `js/project-badge.js:66` `SYNC_MS = 4*60*1000`, used at `:216` |
| STAGE DIRECTORY: 36 FACILITIES | "recount, ~42" | **TRUE** — exactly 36, brace-counted inside the 6 `facilities` arrays of `locations/lib-scout.js` |
| "Tools ×20" | "unsubstantiated" | **no such claim exists on the page** |

### On 3,708 vs 3,194

Both numbers are real and they measure different things. The dataset is 3,708
released features. The five budget-bracket quantile tables sum to n=3,194; the
balance is the ~15.5% "no real release" cohort (`FAILURE_RATE = 0.155`) which
is deliberately excluded from the bands and **reported separately** rather than
silently dropped — see the comment at `producer/sales-forecast.js:22-24`.

"Calibrated on 3,708" is therefore accurate: the failure rate is itself a
calibrated output derived from the full set. Do not "correct" 3,708 to 3,194.

---

## Verified true — leave alone

| Claim | Source |
|---|---|
| WORKING MODULES: 28 | 28 module directories, 1:1 with the nav |
| INCENTIVE PROGRAMS TRACKED: 21 | `taxcredit/lib-taxcred.js:20` — `JURIS` has exactly 21 entries |
| PERMIT OFFICES ON FILE: 6 HUBS | `locations/lib-scout.js` — exactly 6 `facilities` arrays |
| STAGE DIRECTORY: 36 FACILITIES | as above, 36 named facilities across those 6 hubs |
| EXPORT PATH: H.264 · EDL · OTIO | all three exporters ship |
| 2–2.5× BREAKEVEN RULE, derived | `producer/sales-forecast.js:90,280`; `docs/SALES_FORECAST.md:73` — *derived from the waterfall splits*, not asserted, which is the whole point of the claim |
| RENDER GRID: YOUR GPU — LOCAL BRIDGE | self-qualifying: the claim names the local bridge it depends on |
| FULL BACKUP: ONE FILE | the vault exports a single file |

---

## Removed as unsourced

| Claim | Why |
|---|---|
| `TYPICAL SCRIPT-TO-MASTER: 09:12:44` | **No measurement exists anywhere in the repo.** Quoting a duration to the second asserts a benchmark that was never run — the most misleading possible form, because the precision is the claim. Replaced with `SCRIPT TO MASTER IN 5 STAGES · ONE SHARED PROJECT STATE`, both of which are structurally true (the `<ol>` has exactly 5 `pipe-stage__name` entries; the shared project state is `CIN_Projects_v1`). `HUMAN CREW REQUIRED: 1 (YOU)` was kept — it is a claim about what the software is *for*, not a measurement. |
| `124 AUTOMATED CHECKS` | No source anywhere for 124 of anything. Clause deleted; the two verified claims either side of it stand. |

---

## Rules for anyone editing this page

1. **The published landing page is `cinamate/index.html`, NOT root
   `index.html`.** `scripts/deploy_cinamate.mjs:135` copies the cinamate copy
   over the root one in the build output, then `:136` deletes the whole
   `cinamate/` directory. Editing only root ships nothing. The two files are
   currently byte-identical and **must be kept that way** — change both.
2. **Never invent a number.** If you cannot cite the file and line that
   substantiates a figure, the figure does not go on the page.
3. **Never remove a number without checking the docs too**, not just the JS.
   That single mistake produced four of the five false findings above.
4. The page asserts "everything on this page is live in the product." That
   sentence is only true while every other claim on the page is. It is the
   reason this file exists.
