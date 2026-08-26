# CINAMATE

A private studio system — the entire A-to-Z of film production, from treatment
to delivered master, running as one platform with one shared production state.

Live at **cinamate-studio.netlify.app** · 28 working modules · vanilla JS, no
frameworks, no build step · the whole application is served from behind a
server-side gate to five owner accounts.

## What is here

| Area | Where |
|---|---|
| Develop | `/writer/` treatment → screenplay · `/timeline/` the Studio: import, breakdown, estimation |
| Prep | `/producer/` budget top sheet, stripboard, DOOD, call sheets · `/casting/` · `/locations/` · `/props/` · `/sets/` 2D/3D set builder · `/wardrobe/` · `/boards/` |
| Shoot | `/production/` DPR · `/dailies/` take logs · `/today/` the on-set page · `/finance/` Money Room cost report |
| Post & release | `/editor/` cutting room with in-browser MP4 export · `/post/` · `/vfx/` · `/music/` PRO cue sheets · `/festivals/` · `/distribution/` · `/screening/` · `/investors/` · `/taxcredit/` |
| Cross-cutting | `/workflow/` pipeline mission control · `/projects/` vault, backup and studio cloud · `/tools/` sun, media, timecards, registers |

## The parts worth knowing before touching anything

- **`docs/manual/manual.pdf`** — the 20-chapter, 103-page operator's manual,
  written from source. `node scripts/build_manual.mjs` rebuilds it.
- **`docs/audit/BRAND.md`** — the Blue Patina brand specification. Enforced by
  `scripts/test_brand.mjs`, not advisory.
- **`js/lib-scenes.js`** and **`js/lib-money-{math,accounts,sheet}.js`** — the
  one scene model and the one money substrate. Load order is a hard runtime
  contract; the guards throw by name when it is broken.
- **Storage keys are sacred.** Never rename an `SB_*` or `CIN_*` key — that
  silently orphans real production data.

## Verification

```
node scripts/run_all_tests.mjs            # 65 suites
node scripts/scan_html_sinks.mjs --check  # HTML-injection scan, 0 unreviewed
node scripts/smoke_pages.mjs              # 32 pages load clean in a browser
node scripts/test_assurance.mjs           # coverage/duplication ratchet
node scripts/deploy_cinamate.mjs --build-only   # the public/gated partition
```

Deploying to the live site requires the Netlify token, which is deliberately
kept off every machine but the owner's: `node scripts/deploy_cinamate.mjs`
partitions the site into a 31-file public shell and the gated application
bundle, and refuses to run without credentials.
