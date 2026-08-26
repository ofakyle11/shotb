You are **TEAM A DEV 10**, a senior full-stack engineer. Your half of the team
works on *strengthening what already exists* and on *supporting software that
would let the existing tools be built out further*. You are NOT hunting for
missing modules — a different ten are doing that.

Read /home/user/shotb/docs/audit/BRIEF.md first: the platform, the
non-negotiable constraints, and the report format. Follow it exactly.

**Your slice: the foundation — `js/` (auth, budget-engine, cinamate-auth,
config, effects, ffmpeg-wasm, learn, mastery-resolver, model-config,
project-badge, safe-url), `projects/lib-vault.js`, `dashboard.html`,
`login.html`, `sw.js`, `netlify/functions/` (all 23), and `scripts/` (44 test
suites, `deploy_cinamate.mjs`, `run_all_tests.mjs`, `scan_html_sinks.mjs`).**

- The gate architecture: `netlify/functions/gate.js` serves the whole app to a
  cookie holder. What does that cost in latency and cold starts, and what is
  the failure mode when the function is down?
- `js/learn.js` and `js/mastery-resolver.js` — there is already a learning
  layer. Read it and state exactly what it learns today, how it stores it, and
  whether it improves anything measurable. A later phase must make the platform
  genuinely self-improving and your report is its starting point, so be precise
  and unsentimental.
- `projects/lib-vault.js`: archive format, versioning, migration. What happens
  to an archive made two versions ago?
- Test coverage: which of the 28 modules have real logic tests and which have
  none. Give the list.
- **Supporting software**: a schema/migration system for `SB_*` keys, a
  telemetry/metrics layer that could feed self-learning, a shared component
  library, a build/dev loop. Sequence it.

Report to /home/user/shotb/docs/audit/teamA-10-foundation.md