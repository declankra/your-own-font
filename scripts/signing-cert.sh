#!/usr/bin/env bash
# The iOS profile-signing certificate (DECISIONS.md → iOS, SPEC §8.2).
#
#   scripts/signing-cert.sh          Get or renew the Let's Encrypt certificate for $SIGN_DOMAIN,
#                                    then store it as SIGN_CERT/SIGN_KEY/SIGN_CHAIN on Vercel and
#                                    redeploy production so the profile route starts signing.
#
# The DNS check runs through Vercel DNS (`vercel dns add`), so nothing needs clicking. Certificates
# last 90 days and certbot renews once fewer than 30 are left, so run this every ~60 days.
# The key never enters the repo: it lives in $CERT_HOME and in the Vercel env var.
set -euo pipefail

SIGN_DOMAIN="font.dkbuilds.co"
ZONE="dkbuilds.co"
CERT_HOME="$HOME/.config/your-own-font/letsencrypt"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SELF="$ROOT/scripts/signing-cert.sh"

case "${1:-}" in
  auth)
    # certbot hook: publish the TXT record, wait until Vercel's nameserver serves it.
    name="_acme-challenge.${CERTBOT_DOMAIN%."$ZONE"}"
    out="$(cd "$ROOT" && vercel dns add "$ZONE" "$name" TXT "$CERTBOT_VALIDATION" 2>&1)"
    rec="$(grep -o 'rec_[A-Za-z0-9]*' <<<"$out" | head -1)"
    [ -n "$rec" ] || { echo "$out" >&2; exit 1; }
    for _ in $(seq 1 60); do
      dig +short TXT "$name.$ZONE" @ns1.vercel-dns.com | grep -q "$CERTBOT_VALIDATION" && break
      sleep 5
    done
    sleep 15
    echo "$rec" # certbot hands this to the cleanup hook
    ;;
  cleanup)
    [ -n "${CERTBOT_AUTH_OUTPUT:-}" ] && (cd "$ROOT" && vercel dns rm "$CERTBOT_AUTH_OUTPUT" --yes >/dev/null)
    ;;
  "")
    mkdir -p "$CERT_HOME"
    # RSA, not certbot's default ECDSA: node-forge (the route's signer) only reads RSA keys.
    certbot certonly --manual --preferred-challenges dns \
      --manual-auth-hook "$SELF auth" --manual-cleanup-hook "$SELF cleanup" \
      --key-type rsa --rsa-key-size 2048 -d "$SIGN_DOMAIN" \
      --non-interactive --agree-tos --register-unsafely-without-email \
      --config-dir "$CERT_HOME" --work-dir "$CERT_HOME/work" --logs-dir "$CERT_HOME/logs"

    live="$CERT_HOME/live/$SIGN_DOMAIN"
    cd "$ROOT"
    for pair in SIGN_CERT:cert.pem SIGN_KEY:privkey.pem SIGN_CHAIN:chain.pem; do
      base64 -i "$live/${pair#*:}" | tr -d '\n' |
        vercel env add "${pair%%:*}" production --sensitive --force --yes >/dev/null
    done
    echo "Stored SIGN_CERT, SIGN_KEY, SIGN_CHAIN. Expires: $(openssl x509 -enddate -noout -in "$live/cert.pem")"

    # Env vars only reach a new build: rebuild the current production deployment as-is.
    current="$(vercel api "/v6/deployments?projectId=$(sed -E 's/.*"projectId":"([^"]+)".*/\1/' .vercel/project.json)&target=production&state=READY&limit=1" |
      grep -o '"uid": *"dpl_[A-Za-z0-9]*"' | head -1 | grep -o 'dpl_[A-Za-z0-9]*')"
    vercel redeploy "$current" --target production
    ;;
  *) echo "usage: scripts/signing-cert.sh" >&2; exit 2 ;;
esac
