#!/usr/bin/env bash
# OSINT tooling self-check. Run before a research job: it prints what is
# available so the agent works with what it has and notes the rest.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
venv="$here/.venv"

ok() { printf '  ok   %s\n' "$1"; }
no() { printf '  --   %s%s\n' "$1" "${2:+  ($2)}"; }
has() { command -v "$1" >/dev/null 2>&1; }

echo "== OSINT toolkit =="
echo
echo "Scraping / browsing:"
if [ -x "$venv/bin/python" ] && "$venv/bin/python" -c 'import scrapling' 2>/dev/null; then ok "scrapling (venv)"; else no "scrapling" "run scripts/install-osint.sh"; fi
has obscura-browser && ok "obscura-browser" || no "obscura-browser"
has agent-reach && ok "agent-reach" || no "agent-reach"
echo
echo "Free recon CLIs:"
for t in whois dig curl jq exiftool; do has "$t" && ok "$t" || no "$t" "needed by recon.sh"; done
echo
echo "Optional CLIs (deeper recon):"
for t in subfinder theHarvester nmap waybackurls httpx amass sherlock; do has "$t" && ok "$t" || no "$t" "optional"; done
echo
echo "Owner's own accounts (internal intelligence for person dossiers):"
if has tdl || has telegram-cli || [ -n "${TELEGRAM_API_ID:-}" ]; then ok "telegram"; else no "telegram" "connect: tdl, telegram-cli, or TELEGRAM_API_ID"; fi
if has himalaya || has notmuch || has mbsync; then ok "email"; else no "email" "connect: himalaya, notmuch, or mbsync"; fi
if has whatsapp-cli || [ -n "${WHATSAPP_BRIDGE:-}" ]; then ok "whatsapp"; else no "whatsapp" "connect: whatsapp-cli or WHATSAPP_BRIDGE"; fi
crm=""
for k in HUBSPOT_API_KEY PIPEDRIVE_API_TOKEN ATTIO_API_KEY OSINT_CRM OSINT_VAULT; do
  if [ -n "${!k:-}" ]; then crm="$k"; break; fi
done
[ -n "$crm" ] && ok "crm/vault ($crm)" || no "crm/vault" "connect: a CRM API key or OSINT_VAULT dir"
echo
echo "Optional paid search keys (env, never required):"
for k in PERPLEXITY_API_KEY EXA_API_KEY TAVILY_API_KEY SHODAN_API_KEY; do
  [ -n "${!k:-}" ] && ok "$k set" || no "$k" "unset"
done
echo
echo "Majordomo gives the agent WebSearch + WebFetch when web access is on (Settings)."
