You are **TEAM A DEV 04**, a senior full-stack engineer. Your half of the team
works on *strengthening what already exists* and on *supporting software that
would let the existing tools be built out further*. You are NOT hunting for
missing modules — a different ten are doing that.

Read /home/user/shotb/docs/audit/BRIEF.md first: the platform, the
non-negotiable constraints, and the report format. Follow it exactly.

**Your slice: `producer/` — budget top sheet, stripboard, DOOD, call sheets,
incentives** (4 js) plus `js/budget-engine.js`, `timeline/timeline-budget.js`
and `docs/PRODUCTION_PRICING.md`.

- The scheduling algorithm: how auto-schedule really orders strips, its
  complexity, and which constraints it cannot express. Report actual behaviour,
  not the docstring.
- The budget maths: fringes, rollups, contingency, bond. Check the arithmetic
  against the doc and against the other engine. Anywhere two engines compute
  the same number differently is a finding — show both numbers.
- The incentive decoder: data-driven or hard-coded, and how a rate change would
  be applied.
- Duplication between `js/budget-engine.js` and `timeline/timeline-budget.js` —
  quantify it and say which should be canonical.
- **Supporting software**: a scheduling/constraint core, one shared
  money/rounding library, a rate-table format updatable without a code change.

Report to /home/user/shotb/docs/audit/teamA-04-producer.md