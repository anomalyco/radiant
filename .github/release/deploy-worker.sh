#!/usr/bin/env bash
# deploy-worker.sh <dev|production> <dir>: deploys the Radiant Worker from a verified
# Build Output artifact (.cloudflare/output) with the pinned cf CLI and secrets fetched
# from AWS Secrets Manager (radiant/<mode>/*).
. "$(dirname "$0")/lib.sh"

mode=$1
src=$(cd "$2" && pwd)
release=$(cd "$(dirname "$0")" && pwd)

case "$mode" in
  dev | production) ;;
  *) die "Unknown radiant mode: $mode" ;;
esac
target="$release/targets/worker/$mode"
[ -f "$target/root.json" ] && [ -f "$target/worker.json" ] || die "No pinned worker targets for $mode"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
CLOUDFLARE_ACCOUNT_ID=$(stage_account "$mode")
export CLOUDFLARE_ACCOUNT_ID

unexpected=$(cd "$src" && find . ! -type d ! -type f -o -type f ! -path ./SHA256SUMS \
  ! -path ./v0/config.json \
  ! -path ./v0/workers/default/worker.config.json \
  ! -path './v0/workers/default/bundle/*' \
  ! -path './v0/workers/default/assets/*')
[ -z "$unexpected" ] || die "Unexpected files in the worker artifact: $unexpected"
[ -f "$src/v0/workers/default/bundle/index.js" ] || die "The worker artifact has no bundle/index.js"

expect_json "$src/v0/config.json" "$target/root.json" "Radiant root config"
expect_json "$src/v0/workers/default/worker.config.json" "$target/worker.json" "Radiant worker config"

work=$(mktemp -d)
umask 077
secrets_file=$(mktemp "$work/secrets.XXXXXX.json")
trap 'rm -rf "$work"' EXIT

read_secret() {
  local val
  val=$(aws secretsmanager get-secret-value \
    --region us-east-1 \
    --secret-id "radiant/$mode/$1" \
    --query SecretString \
    --output text)
  if [ "$val" = "unset" ]; then
    printf ''
  else
    printf '%s' "$val"
  fi
}

jq -n \
  --arg DATABASE_URL "$(read_secret DATABASE_URL)" \
  --arg DATABASE_READ_URL "$(read_secret DATABASE_READ_URL)" \
  --arg ENCRYPTION_KEY "$(read_secret ENCRYPTION_KEY)" \
  --arg SESSION_SECRET "$(read_secret SESSION_SECRET)" \
  --arg PLAID_CLIENT_ID "$(read_secret PLAID_CLIENT_ID)" \
  --arg PLAID_SECRET "$(read_secret PLAID_SECRET)" \
  '{DATABASE_URL:$DATABASE_URL,DATABASE_READ_URL:$DATABASE_READ_URL,ENCRYPTION_KEY:$ENCRYPTION_KEY,SESSION_SECRET:$SESSION_SECRET,PLAID_CLIENT_ID:$PLAID_CLIENT_ID,PLAID_SECRET:$PLAID_SECRET}' \
  > "$secrets_file"

output="$work/.cloudflare/output/v0"
mkdir -p "$output/workers/default"
cp "$target/root.json" "$output/config.json"
cp "$target/worker.json" "$output/workers/default/worker.config.json"
cp -R "$src/v0/workers/default/bundle" "$output/workers/default/bundle"
# The web app's build (packages/web), served through the ASSETS binding.
[ -f "$src/v0/workers/default/assets/index.html" ] || die "The worker artifact has no web app assets"
cp -R "$src/v0/workers/default/assets" "$output/workers/default/assets"

cf="$release/cf/node_modules/.bin/cf"
[ -x "$cf" ] || die "Install the pinned cf CLI first: npm ci --ignore-scripts in .github/release/cf"

cd "$work"
"$cf" deploy --prebuilt --mode "$mode" --secrets-file "$secrets_file"
