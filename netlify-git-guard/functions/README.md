# Deliberately empty

`netlify.toml` points `functions` here, not at `netlify/functions`, for the
same reason `publish` points at the directory above this one: a git build
must fail closed.

`netlify/functions` holds 23 endpoints. Three of them — `gate`,
`verify-owner` and `projects-sync` — are the ones a release actually needs,
and `scripts/deploy_cinamate.mjs` uploads exactly those three, by hand, over
the API. The other twenty take prompts, call paid models, seed data and
receive Stripe webhooks. A git build wired to this repository would have
deployed all twenty-three with no owner check in front of them, on a site
whose static half was correctly serving nothing but a placeholder.

Nothing should be added to this directory. To ship a real release:

    node scripts/deploy_cinamate.mjs cinamate-studio
