# Feature Candidates — OSS-Grounded Menu (Awaiting Approval)

Compiled 2026-08-18 from three GitHub surveys (production ops, business
side, creative tools). Every repo below was verified live — license
checked against the actual LICENSE file, last-push year and maintenance
confirmed. **Nothing on this menu is built or added — it is a proposal
list awaiting approval.**

Verdict codes used throughout:
**(a)** adopt the code directly · **(b)** re-implement its data model ·
**(c)** integrate at arm's length or load on demand · **(d)** genuine OSS
gap — Cinamate would be first.

---

## Tier 1 — Quick wins (small builds on adopt-ready OSS)

| # | Feature | What studios get | OSS foundation | Verdict |
|---|---|---|---|---|
| 1 | **Weather & golden-hour scheduling** | Each stripboard day shows sunrise/sunset, golden/blue hour and a weather-risk flag for its location — reorder days before weather kills them | [suncalc](https://github.com/mourner/suncalc) (BSD-2), [Astronomy Engine](https://github.com/cosinekitty/astronomy) (MIT), [Open-Meteo](https://github.com/open-meteo/open-meteo) keyless CORS API | (a) libs + (d) overlay |
| 2 | **Script revisions & colored pages** | Draft-compare with change bars, Blue/Pink/Yellow revision generations, locked pages — the industry revision workflow, which has no OSS implementation anywhere | [jsdiff](https://github.com/kpdecker/jsdiff) (BSD-3) + our parser; [Beat](https://github.com/lmparppei/Beat)'s revision model as reference (GPL — model only) | (a)+(d) |
| 3 | **Union timecard calculator** | Call/wrap times (already on our call sheets) → gross pay with IATSE/SAG OT, golden hours, meal penalties, turnaround, 6th/7th-day premiums — zero OSS competition | Pure-function rules engine, native | (d) |
| 4 | **Credit-roll generator** | Crew/cast data already in the budget → broadcast-ready scrolling credits, exported as video in-browser | [mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2, WebCodecs) | (d) build, (c) export |
| 5 | **Lens/FOV calculator** | Sensor + focal length + distance → field-of-view and coverage previz; later feeds a 3D camera frustum | One-file math; no adoptable OSS exists | (d) |
| 6 | **EPK / press-kit generator** | One click: branded electronic press kit page (stills, synopsis, credits, tech specs) from data the platform already holds | Native (we are a static-site pipeline already) | (d) |

## Tier 2 — Medium builds on strong MIT/BSD foundations

| # | Feature | What studios get | OSS foundation | Verdict |
|---|---|---|---|---|
| 7 | **Moodboards & lookbooks** | Infinite-canvas boards for look development, pinned to projects | [Konva](https://github.com/konvajs/konva) or [Fabric.js](https://github.com/fabricjs/fabric.js) (both MIT). **Not tldraw** — proprietary license | (c) |
| 8 | **Stills & plates editor** | Layered image editing, upscaling, background removal for portraits/plates | [miniPaint](https://github.com/viliusle/miniPaint) (MIT, adopt), [UpscalerJS](https://github.com/thekevinscott/UpscalerJS) (MIT, on-demand), [rembg](https://github.com/danielgatis/rembg) (MIT, serverless) | (a)/(c) |
| 9 | **Audio bay** | Waveform editing, multitrack temp mixes, EBU R128 loudness metering in-browser | [AudioMass](https://github.com/pkalogiros/AudioMass) (MIT, ~65KB vanilla JS), [wavesurfer.js](https://github.com/katspaugh/wavesurfer.js) (BSD-3), [waveform-playlist](https://github.com/naomiaro/waveform-playlist) (MIT), [needles](https://github.com/domchristie/needles) (MIT R128) | (a)/(c) |
| 10 | **Captions & subtitles** | Auto-transcribe in the browser (no server), edit against the waveform, export SRT/VTT | [subtitle.js](https://github.com/gsantiago/subtitle.js) (MIT), [transformers.js](https://github.com/huggingface/transformers.js) Whisper (Apache-2), [SubPlayer](https://github.com/zhw2590582/SubPlayer) (MIT, archived — fork-and-own) | (c)/(a) |
| 11 | **Story bibles** | Per-project character/world wiki auto-seeded from the parser's characters & locations | [TiddlyWiki5](https://github.com/TiddlyWiki/TiddlyWiki5) (BSD-3, single-file, embeddable); [novelWriter](https://github.com/vkbo/novelwriter)'s tag schema (reference) | (a)/(b) |
| 12 | **Pitch decks** | In-platform decks that pull lookbook frames and previz clips straight into slides | [reveal.js](https://github.com/hakimel/reveal.js) (MIT) | (c) |
| 13 | **Rough-cut assembly** | Sequence previz clips + titles + temp audio on a timeline; hardware-speed export in the browser | [mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2) + WebCodecs; [omniclip](https://github.com/omni-media/omniclip) (MIT) as code donor; ffmpeg.wasm (LGPL core) fallback | (c)/(a) |
| 14 | **Hot-cost reporting** | Actuals + committed POs vs budget line, per top-sheet account, exportable to real accounting tools | Plain-text-accounting model ([beancount](https://github.com/beancount/beancount)/[hledger](https://github.com/simonmichael/hledger) journal format — format, not their GPL code) | (b) |
| 15 | **Deal memos & releases + e-sign** | Answer questions → generated deal memo/appearance release; legally signed | [docxtemplater](https://github.com/open-xml-templating/docxtemplater) / [docx](https://github.com/dolanmiu/docx) (MIT, in-browser); [DocuSeal](https://github.com/docusealco/docuseal)/[Documenso](https://github.com/documenso/documenso) (AGPL — self-hosted service via API only) | (a)+(c) |
| 16 | **Digital slate & take logger** | Phone-friendly slate (scene/take/roll, sync flash+tone); takes log into the schedule data | [smpte-timecode](https://github.com/CrystalComputerCorp/smpte-timecode) (MIT) | (a)+(d) |
| 17 | **Media offload verification** | Drag a card folder → SHA-256 manifest per the ASC MHL spec, verified in-browser — first implementation anywhere outside desktop tools | [ascmitc/mhl](https://github.com/ascmitc/mhl) (MIT spec + reference) + WebCrypto | (b)/(d) |

## Tier 3 — Bigger, category-first builds (no OSS competitor exists)

| # | Feature | What studios get | Foundation | Verdict |
|---|---|---|---|---|
| 18 | **Dailies review & annotation** | Frame-accurate review with drawing + threaded notes in the browser — no OSS web equivalent exists (OpenRV/xstudio are C++ desktop) | Native (`requestVideoFrameCallback` + canvas); [Kitsu](https://github.com/cgwire/kitsu)'s annotation JSON as reference (AGPL — model only) | (d) |
| 19 | **Continuity & lined scripts** | Editor's lines over the parsed script, circled takes, continuity photos per scene/take — clearest gap in the entire survey | Native; we already own the script-parsing half | (d) |
| 20 | **Chain-of-title rights graph** | Underlying rights → options → licenses → distribution grants with territory/term/media splits and reversion dates | Native; no OSS models film rights | (d) |
| 21 | **Festival submission tracker** | Deadlines, fees, statuses, premiere strategy — FilmFreeway has no OSS analog | Native; pairs with the doc grants panel | (d) |
| 22 | **Crew directory & call-sheet distribution** | Crew database (roles, rates, dietary, emergency contacts) + who received/confirmed each call sheet | Native; nothing exists above 2 stars | (d) |
| 23 | **COI / insurance register** | Certificates, limits, additional insureds, expiry reminders tied to locations | Native; confirmed gap | (d) |
| 24 | **Buyer/investor deal tracker** | Distributor/territory/deal pipeline with activity log | Thin native tracker ([Krayin](https://github.com/krayin/laravel-crm) MIT schema as reference), or [Twenty](https://github.com/twentyhq/twenty) self-hosted | (b) or (c) |
| 25 | **Finance waterfall instruments** | Investor units, premiums, corridors, deferrals, participations layered on our existing waterfall forecaster | [Open Cap Format](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF) vocabulary; RSL spec as design reference | (b)+(d) |
| 26 | **3D previz & virtual scouting** | glTF set models with camera blocking; map-based location scouting; Gaussian-splat scanned locations | [three.js](https://github.com/mrdoob/three.js) (MIT), [three-gltf-viewer](https://github.com/donmccurdy/three-gltf-viewer) (MIT), [MapLibre](https://github.com/maplibre/maplibre-gl-js) (BSD-3), [PlayCanvas](https://github.com/playcanvas/engine) (MIT) | (c)+(d) |
| 27 | **Color & look development** | Load/apply .cube LUTs on previz footage in-browser; a house film-emulation LUT pack we generate ourselves (license-clean) | three.js `LUTCubeLoader`/`LUTPass` (MIT), [parse-cube-lut](https://github.com/thibauts/parse-cube-lut) (MIT), [spectral_film_lut](https://github.com/JanLohse/spectral_film_lut) (MIT) | (a)/(c) |
| 28 | **Delivery QC** | Serverless loudness (EBU R128) and caption-format checks against delivery specs | ffmpeg `ebur128`/loudnorm, [ffmpeg-normalize](https://github.com/slhck/ffmpeg-normalize) (MIT), [pycaption](https://github.com/pbs/pycaption) (Apache-2) | (a) |
| 29 | **Screeners & data rooms** | Watermarked screener rooms; investor data rooms with per-page view analytics | [PeerTube](https://github.com/Chocobozzz/PeerTube) / [Papermark](https://github.com/papermark/papermark) (AGPL — self-hosted services, never embedded) | (c) |
| 30 | **Audience & marketing layer** | Privacy-first site analytics surfaced in the console; social scheduling | [Umami](https://github.com/umami-software/umami) (MIT), [Postiz](https://github.com/gitroomhq/postiz-app)/[Mixpost Lite](https://github.com/inovector/mixpost) | (c) |

---

## License traps found (verified — do NOT adopt code from these)

- **Storyboarder** — no license file at all (not actually open source)
- **tldraw** — proprietary "tldraw license", telemetry-enforced
- **Remotion** — free only for ≤3-person companies
- **Akaunting** (BSL) and **Invoice Ninja** (Elastic 2.0) — no longer open source
- **@imgly/background-removal** — AGPL (network copyleft)
- **AYON backend** — FSL (delayed open source); only ayon-core is Apache-2
- **ffmpeg.wasm** — wrapper is MIT but codec builds vary (x264 = GPL; use LGPL core)
- AGPL server suites (Kitsu, DocuSeal, Documenso, Papermark, PeerTube, Snipe-IT,
  Shelf.nu, Twenty, Postiz, Plausible server) — **integrate as self-hosted
  services via API only**, never embed their code
- MusicGen/audiocraft — MIT code but **non-commercial model weights**

## Recommended first approval batch

Highest studio value per unit of effort, most on-brand, and mostly
category-firsts:

1. **Weather & golden-hour scheduling** (#1) — tiny build, instantly useful every shoot day
2. **Script revisions & colored pages** (#2) — core producer workflow, first in OSS
3. **Union timecard calculator** (#3) — real money, pairs with existing call sheets
4. **Rough-cut assembly + credit rolls** (#13 + #4) — previz becomes a watchable, exportable cut
5. **Dailies review & annotation** (#18) — the collaboration backbone every studio asks for

Nothing proceeds until approved.
