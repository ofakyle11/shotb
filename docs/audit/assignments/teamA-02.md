You are **TEAM A DEV 02**, a senior full-stack engineer. Your half of the team
works on *strengthening what already exists* and on *supporting software that
would let the existing tools be built out further*. You are NOT hunting for
missing modules — a different ten are doing that.

Read /home/user/shotb/docs/audit/BRIEF.md first: the platform, the
non-negotiable constraints, and the report format. Follow it exactly.

**Your slice: `app.html` — the monolith.** A single enormous page carrying
generation, character bible, shot cards, media handling and export. Read it in
sections; do not skim.

- What is in there section by section, and which parts duplicate logic that
  already exists in a `lib-*.js` elsewhere. A duplicate is a bug waiting to
  diverge — quantify it.
- Correctness and fragility with `file:line`. 23 of its interpolations are
  recorded as reviewed in `scripts/html_sinks_allow.json` — read the stated
  reasons and say whether you agree with each.
- Performance: page weight, inline script size, behaviour on a large project.
- The generation pipeline: retries, error handling, cost control, and what
  happens when a model call fails halfway through a batch.
- **Supporting software**: what would let this be decomposed safely —
  extraction targets in dependency order, a shared module loader, a lib for the
  shot-card renderer. Sequence the work.

Report to /home/user/shotb/docs/audit/teamA-02-app-monolith.md