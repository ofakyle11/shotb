#!/usr/bin/env bash
# Deploy the combined Cinamate site (Studio + Producer Suite) to Netlify.
#
#   NETLIFY_AUTH_TOKEN=nfp_xxx ./scripts/deploy_cinamate.sh [site-name]
#
# Thin wrapper — the real work (static build, branding/theme transforms,
# digest deploy including the /verify-owner login function, env-var
# provisioning) lives in deploy_cinamate.mjs. See that file for the
# optional OWNER_PW_* / OWNER_TOKEN_SECRET env inputs.
set -euo pipefail
exec node "$(cd "$(dirname "$0")" && pwd)/deploy_cinamate.mjs" "$@"
