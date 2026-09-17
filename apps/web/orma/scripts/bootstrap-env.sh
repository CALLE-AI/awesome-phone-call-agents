#!/usr/bin/env bash
# Rebuild .env from the environment.
#
# The repository never carries .env. A cloud agent, a Codespace or a workflow
# gets the values as GitHub variables and secrets instead, and this script turns
# them back into the file the tooling expects.
#
# Locally:   gh variable list / gh secret list show what exists, but secret
#            VALUES cannot be read back out of GitHub by design. Keep your own
#            .env, or ask whoever set them.
# In CI:     export every name below through the workflow `env:` block, then run
#            this script.
#
# Usage: ./scripts/bootstrap-env.sh [output-path]   (default .env)
set -euo pipefail

OUT="${1:-.env}"
KEYS=(
  ORMA_ENV ORMA_DRY_RUN ORMA_PUBLIC_URL ORMA_API_URL ORMA_OWNER_PHONE
  ORMA_WEBHOOK_SECRET
  # Selects which recorded fixture a dry run synthesises. Defaults to completed.
  ORMA_DRY_RUN_FIXTURE
  SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY
  SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_PASSWORD SUPABASE_DB_URL
  ORMA_MATERIALISE_SECRET_KEY
  CALLE_API_BASE CALLE_API_KEY
  TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
  GOOGLE_VERTEX_PROJECT GOOGLE_VERTEX_LOCATION GOOGLE_APPLICATION_CREDENTIALS_JSON
  GEMINI_MODEL
  RESEND_API_KEY RESEND_FROM
  CF_DNS_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_ZONE_ID
)

umask 077
: > "$OUT"
missing=()
for k in "${KEYS[@]}"; do
  v="${!k-}"
  if [ -z "$v" ]; then missing+=("$k"); continue; fi
  # Single-quote every value. The service account JSON contains spaces and
  # double quotes, and would otherwise break `set -a; . ./.env`.
  printf "%s='%s'\n" "$k" "$v" >> "$OUT"
done
chmod 600 "$OUT"

echo "wrote $OUT with $(( ${#KEYS[@]} - ${#missing[@]} )) of ${#KEYS[@]} keys"
if [ ${#missing[@]} -gt 0 ]; then
  printf 'missing: %s\n' "${missing[*]}"
  exit 1
fi
