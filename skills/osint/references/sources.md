# Free OSINT sources (keyless or free tier)

Read when you need a source for a specific question. Open data only; respect
each site's terms and robots. Prefer official registries and APIs over scraping.

## Domains and infrastructure (own / authorized / due diligence)
- **whois** - registrar, dates, nameservers, registrant org (often redacted).
- **DNS** - `dig`, or DoH `https://dns.google/resolve?name=<d>&type=<t>`.
- **Certificate transparency** - `https://crt.sh/?q=%25.<domain>&output=json`:
  subdomains and cert history, no key. (recon.sh domain/subdomains/certs)
- **Wayback Machine** - `http://web.archive.org/cdx/search/cdx?url=<d>/*` and
  `https://web.archive.org/web/<timestamp>/<url>`: deleted pages, old bios.
- **Shodan / Censys** - exposed services. Free tier needs a key; only against
  assets you own or are authorized to assess.
- **BGP / ASN** - bgp.he.net for who hosts an IP range.

## Companies and entities
- Official company registries (per country), the entity's own site and docs,
  reputable press, job posts (reveal stack and team), GitHub org, status pages.

## People (public professional due diligence only)
- Public professional profiles the person published, the company's team page,
  conference speaker bios, bylines, public code. Confirm identity across a
  namesake with at least two linking facts. Nothing private, nothing about
  location or movements.

## Content provenance / verification
- Reverse image search, EXIF via `exiftool` (recon.sh meta) on already-public
  files, the Wayback Machine for the earliest copy, account creation dates.

## Breach exposure (the owner's own identifiers)
- Have I Been Pwned (manual, or API key). Use only for the owner's own emails.

## Optional paid search (slotted in via env if the owner adds a key)
- Perplexity / Exa / Tavily for faster, cited search. Never required; the
  WebSearch and WebFetch tools cover the open-web pass.
