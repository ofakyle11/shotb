#!/usr/bin/env bash
# Deploy the combined Cinamate site (Studio + Producer Suite) to Netlify.
#
#   NETLIFY_AUTH_TOKEN=nfp_xxx ./scripts/deploy_cinamate.sh [site-name]
#
# Builds a static deploy from this repo: the Cinamate landing page becomes
# the site root, the Studio (/timeline/) and Producer Suite (/producer/)
# ship as-is with their topbars rebranded CINAMATE in the deployed copy
# only — the repo itself stays Shotbreak-branded.
#
# Note: this is a static (zip) deploy. Netlify functions (clip generation,
# agent backend) are NOT part of it — link the GitHub repo to the Netlify
# site and set the API keys in the Netlify env to enable generation.
set -euo pipefail

[ -n "${NETLIFY_AUTH_TOKEN:-}" ] || { echo "NETLIFY_AUTH_TOKEN is required" >&2; exit 1; }
SITE_NAME="${1:-cinamate}"
API="https://api.netlify.com/api/v1"
AUTH=(-H "Authorization: Bearer ${NETLIFY_AUTH_TOKEN}")
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
DEPLOY="$WORK/site"
trap 'rm -rf "$WORK"' EXIT

# ── 1. assemble the static site ─────────────────────────────────────────
mkdir -p "$DEPLOY"
tar -C "$ROOT" -cf - \
  --exclude './.git' --exclude './local-backend' --exclude './private' \
  --exclude './scripts' --exclude './netlify' --exclude './docs' \
  --exclude '*.zip' --exclude '*.jpeg' --exclude '*.ps1' --exclude '*.bat' \
  --exclude './local-server.py' --exclude './package.json' --exclude './netlify.toml' \
  --exclude './.netlifyignore' --exclude './.firebaserc' --exclude './firebase.json' \
  --exclude './database.rules.json' \
  . | tar -C "$DEPLOY" -xf -

cp "$ROOT/cinamate/index.html" "$DEPLOY/index.html"

# Rebrand the two product pages for the Cinamate site (deployed copy only)
sed -i 's|<div class="logo">SHOT<span>BREAK</span></div>|<div class="logo">CINA<span>MATE</span></div>|' \
  "$DEPLOY/timeline/index.html" "$DEPLOY/producer/index.html"
sed -i 's|<title>SHOTBREAK — Text-to-Video Movie System</title>|<title>CINAMATE — Studio</title>|' "$DEPLOY/timeline/index.html"
sed -i 's|<title>SHOTBREAK — Producer Suite</title>|<title>CINAMATE — Producer Suite</title>|' "$DEPLOY/producer/index.html"

( cd "$DEPLOY" && zip -qr "$WORK/site.zip" . )
echo "Deploy bundle: $(du -h "$WORK/site.zip" | cut -f1) ($(cd "$DEPLOY" && find . -type f | wc -l) files)"

# ── 2. find or create the Netlify site ──────────────────────────────────
SITE_ID="$(curl -sS "${AUTH[@]}" "$API/sites?name=$SITE_NAME" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  const sites=JSON.parse(d||"[]");
  const hit=sites.find(s=>s.name===process.argv[1]);
  process.stdout.write(hit?hit.id:"");
})' "$SITE_NAME")"

if [ -z "$SITE_ID" ]; then
  for name in "$SITE_NAME" "$SITE_NAME-studio" "$SITE_NAME-app" "$SITE_NAME-$(date +%s | tail -c 5)"; do
    RESP="$(curl -sS "${AUTH[@]}" -H 'Content-Type: application/json' -d "{\"name\":\"$name\"}" "$API/sites")"
    SITE_ID="$(printf '%s' "$RESP" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const s=JSON.parse(d);process.stdout.write(s.id||"")}catch(e){}})')"
    [ -n "$SITE_ID" ] && { echo "Created site: $name"; break; }
    echo "Name '$name' unavailable, trying next…"
  done
fi
[ -n "$SITE_ID" ] || { echo "Could not find or create a Netlify site" >&2; exit 1; }

# ── 3. zip deploy + poll until live ─────────────────────────────────────
DEPLOY_JSON="$(curl -sS "${AUTH[@]}" -H 'Content-Type: application/zip' \
  --data-binary "@$WORK/site.zip" "$API/sites/$SITE_ID/deploys")"
DEPLOY_ID="$(printf '%s' "$DEPLOY_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const s=JSON.parse(d);process.stdout.write(s.id||"")}catch(e){}})')"
[ -n "$DEPLOY_ID" ] || { echo "Deploy failed: $DEPLOY_JSON" >&2; exit 1; }

for i in $(seq 1 30); do
  STATE_JSON="$(curl -sS "${AUTH[@]}" "$API/deploys/$DEPLOY_ID")"
  STATE="$(printf '%s' "$STATE_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const s=JSON.parse(d);process.stdout.write(s.state||"")}catch(e){}})')"
  echo "  deploy state: $STATE"
  [ "$STATE" = "ready" ] && break
  [ "$STATE" = "error" ] && { echo "Deploy errored: $STATE_JSON" >&2; exit 1; }
  sleep 4
done

printf '%s' "$STATE_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  const s=JSON.parse(d);
  console.log("\nLive: "+(s.ssl_url||s.url));
  console.log("Admin: "+(s.admin_url||""));
})'
