#!/usr/bin/env bash
# Keyless OSINT recon over free, public sources. For the owner's own assets,
# authorized targets, or entity due diligence. Open data only; nothing intrusive.
#
#   recon.sh domain <domain>        whois, DNS, cert-transparency subdomains
#   recon.sh subdomains <domain>    subdomains from crt.sh (+ subfinder if present)
#   recon.sh certs <domain>         certificate history (crt.sh)
#   recon.sh wayback <domain|url>   known URLs from the Wayback Machine
#   recon.sh footprint <term>       where a username/email/handle shows publicly
#   recon.sh meta <file>            metadata of an already-downloaded public file
set -u
cmd="${1:-}"; arg="${2:-}"
die() { echo "recon.sh: $*" >&2; exit 2; }
[ -n "$cmd" ] || die "usage: domain|subdomains|certs|wayback|footprint|meta <arg>"
[ -n "$arg" ] || die "$cmd needs an argument"
UA="Mozilla/5.0 (OSINT due-diligence; respects robots)"
get() { curl -fsS --max-time 30 -A "$UA" "$@"; }

crt() { # subdomains from certificate transparency (crt.sh), deduped
  get "https://crt.sh/?q=%25.${1}&output=json" 2>/dev/null \
    | jq -r '.[].name_value' 2>/dev/null | tr '[:upper:]' '[:lower:]' \
    | sed 's/^\*\.//' | sort -u
}

case "$cmd" in
  domain)
    echo "== whois $arg =="
    if command -v whois >/dev/null; then whois "$arg" | grep -iE 'registrar|creation|created|updated|expir|name server|registrant org|status:' | head -30; else echo "(whois not installed)"; fi
    echo; echo "== DNS $arg =="
    if command -v dig >/dev/null; then for r in A AAAA MX NS TXT; do echo "-- $r"; dig +short "$arg" "$r"; done; else get "https://dns.google/resolve?name=${arg}&type=ANY" | jq -r '.Answer[]? | "\(.type) \(.data)"'; fi
    echo; echo "== subdomains (crt.sh) =="; crt "$arg" | head -200 ;;
  subdomains)
    { crt "$arg"; command -v subfinder >/dev/null && subfinder -silent -d "$arg" 2>/dev/null; } | sort -u ;;
  certs)
    get "https://crt.sh/?q=${arg}&output=json" | jq -r 'sort_by(.entry_timestamp) | .[] | "\(.entry_timestamp[0:10])  \(.issuer_name | sub(".*O=";"") )  \(.name_value)"' 2>/dev/null | sort -u | tail -60 ;;
  wayback)
    get "http://web.archive.org/cdx/search/cdx?url=${arg}/*&output=text&fl=original&collapse=urlkey&limit=500" | sort -u ;;
  footprint)
    # Point the agent at public search; it then uses WebSearch/WebFetch to verify.
    echo "Search these (verify every hit against a named source before trusting it):"
    for q in "\"$arg\"" "\"$arg\" site:github.com" "\"$arg\" site:linkedin.com" "\"$arg\" profile"; do
      echo "  web_search $q"
    done
    echo "Breach exposure (owner's own emails only): https://haveibeenpwned.com/ (manual, or HIBP API key)" ;;
  meta)
    [ -f "$arg" ] || die "no such file: $arg"
    if command -v exiftool >/dev/null; then exiftool -g1 -a -u "$arg"; else echo "(exiftool not installed)"; fi ;;
  *) die "unknown command: $cmd" ;;
esac
