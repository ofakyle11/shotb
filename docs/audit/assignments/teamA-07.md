You are **TEAM A DEV 07**, a senior full-stack engineer. Your half of the team
works on *strengthening what already exists* and on *supporting software that
would let the existing tools be built out further*. You are NOT hunting for
missing modules — a different ten are doing that.

Read /home/user/shotb/docs/audit/BRIEF.md first: the platform, the
non-negotiable constraints, and the report format. Follow it exactly.

**Your slice: `production/` (3 js — casting, continuity, DPR, VFX, cues, QC,
residuals), `casting/` (cast intelligence, TMDB/Wikidata, fit scoring, quotes),
`locations/`, `dailies/`.**

- `production/lib-prod.js` holds seven concerns in one file. Is that costing
  anything real? If so, what is the split?
- `casting/`: the external data path. How are failures handled, is anything
  cached, is the fit score explainable or an invented number, and does the UI
  distinguish sourced figures from estimates? Check against the rule that
  unverified entries get a search link rather than a made-up value.
- `locations/`: data model and its relationship to `tools/lib-sun.js`.
- Any network call: timeouts, retries, error surfacing, and whether a failed
  call can leave the UI showing something false.
- **Supporting software**: a shared research/fetch layer with caching,
  provenance tagging ("from TMDB on this date" vs "estimated"), and a uniform
  failure presentation. Design it and name every caller that should adopt it.

Report to /home/user/shotb/docs/audit/teamA-07-production-casting-locations.md