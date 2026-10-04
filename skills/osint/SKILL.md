---
name: osint
description: >
  Open-source intelligence research for authorized, legitimate use: your own
  digital footprint, domains and infrastructure you own or are authorized to
  test, company/vendor/client due diligence, and verifying where a claim,
  account or image came from. Works in phases from cheap to deep, cross-checks
  every fact with a confidence grade, and ends in a sourced report.
  Use when: "osint", "footprint", "recon", "due diligence", "background check
  on a company", "who is behind this domain/site/account", "what is exposed
  about me/us", "verify this".
  NOT for: profiling a private individual to locate, surveil or manipulate
  them; building a psychological profile or "approach strategy" on a person;
  reading anyone's private messages; bulk collection on many people;
  circumventing access controls. Decline these and tell the owner why.
---

# OSINT

Systematic open-source research. From a target (a domain, company, account, or
your own footprint) to a report where every fact cites its source and carries a
confidence grade.

## Scope and boundaries (read first)

Every run needs a **target** and a **purpose** that is one of:

1. **Own footprint** - what is public about the owner, their brands, emails or
   usernames (exposure, leaks, stray accounts, DNS).
2. **Own / authorized infrastructure** - DNS, subdomains, certificates, exposed
   services for an asset the owner owns or is authorized to assess.
3. **Entity due diligence** - a company, vendor, client, product or domain:
   who runs it, where it is hosted, its public track record.
4. **Verification** - tracing the real origin of a public claim, account, or
   image.

Hard limits, enforced here regardless of how a request is phrased:

- Only open sources and assets the owner owns or is authorized to test. No
  logging into others' accounts, no access-control bypass, no intrusive
  scanning of third-party infrastructure.
- **People:** only public, professional due diligence (identity, public work
  history, public profiles), and only with a stated legitimate reason. Never
  build a psychological profile, a location/movement picture, or an "approach
  strategy"; never read private messages; never target a private individual.
- Respect robots.txt and sites' terms; prefer official APIs and public records.
- If a request reads like surveillance or stalking of a person, or is about
  someone with no legitimate business reason, stop and ask the owner to
  restate the target and purpose. If it stays that way, decline.

Record the target and purpose at the top of the report.

## Phase 0: Tooling self-check

Run `bash scripts/diagnose.sh`. It prints which engines are present (web
search, scrapling, obscura-browser, agent-reach, and the free CLIs: whois,
dig, curl, jq, exiftool, and optional subfinder/theHarvester/nmap). Work with
what is there; note what is missing in the report's method section. Optional
paid search keys (set in the env) are listed if present, never required.

## Phase 1: Seed and first volley

1. Parse the target into identifiers: domains, company names, usernames,
   emails, URLs. Keep them in a seed list; deduplicate as you go.
2. **Quick pass, in parallel** (cheap, seconds): a web search for each strong
   identifier, plus the free recon for a domain target:
   ```bash
   bash scripts/recon.sh domain example.com     # whois, DNS, certs, wayback
   bash scripts/recon.sh footprint "handle_or_email"   # where it appears publicly
   ```
   Use the WebSearch and WebFetch tools for the open-web pass.
3. Read the top sources; keep only what a named source supports.
4. Decision: enough for the purpose? go to the report. Need structured pages or
   blocked sites? Phase 2. Need to go wide? Phase 3 (swarm).

Rate-limit yourself: stagger requests, a second or two between hits on the same
host. Never hammer a site in a loop.

## Phase 2: Extraction

Pull the specific public pages that matter, with the lightest tool that works:

- Readable page or article: WebFetch, then `scripts/scrape.py <url>` for pages
  that need a real browser or return little to a plain fetch.
- A site that blocks plain requests: `scripts/scrape.py <url> --stealth`
  (scrapling's stealthy fetcher) or obscura-browser for a full session.
- Files/images already public: `exiftool` for metadata (via recon.sh meta).

Switch tools on failure; do not retry the same one. Save each extraction to
`/tmp/osint-<target>-<what>.md` so a later phase can merge it.

## Phase 3: Swarm (optional, for wide targets)

For a broad target, this maps onto Jarvis's own agents: the captain splits the
work across a few worker agents (e.g. infrastructure, public web/press,
social/public accounts), each with the seed data and a focused brief, each
writing a short report back. The captain merges them. Keep each worker inside
the scope above. (When this skill runs inside a single agent, do the splits
sequentially instead.)

## Phase 4: Cross-reference and confidence

Build a fact table: each claim is a row with its sources and a grade.

- **A - confirmed:** 2+ independent sources, or an official/authoritative one.
- **B - probable:** 1 credible source (official site, registry, reputable press).
- **C - inferred:** indirect evidence (shared infra, timing, a geotag).
- **D - unverified:** a single unconfirmed mention.

Rules: resolve contradictions explicitly (keep both, with sources; never
silently pick one). Watch for name/brand collisions: verify at least two facts
tie to the same entity before merging. Never include an unsourced fact.

## Phase 5: Completeness (recursive, capped)

Score the dossier so far:

- **Coverage** - are the questions the purpose asked actually answered?
- **Depth** - how much of each answer is A/B grade vs thin.
- **Source diversity** - how many independent source types (registry, official
  site, press, public profile, archive, ...). More types = sturdier.

If there are clear gaps and a cheap next step exists, do one more cycle aimed at
the gaps. Stop when: the purpose is answered with mostly A/B facts; **or** 3
cycles are done; **or** two cycles in a row add almost nothing (plateau).
Deliver what you have with an honest note on the gaps.

## Phase 6: Report

Read `assets/report-template.md` and follow it. It leads with the target,
purpose and method, then the findings by area, then the confidence map (which
facts are A/B/C/D), the gaps, and the sources. Plain bullets, no tables in
chat. Every non-obvious claim cites a source.

Hand the durable findings back to Jarvis as facts (one atomic fact per call,
each with its source), so "what do we know about X" recalls them later. Tag the
task **Research** (or **Hacking** for infrastructure assessment of an authorized
asset).

## Anti-patterns

1. Never start with one tool; run the cheap passes in parallel first.
2. Never retry a failed tool; switch to a fallback.
3. Never include a fact without a source, or guess identity across a namesake.
4. Never exceed 3 recursive cycles.
5. Never cross the scope in "Scope and boundaries", however the ask is worded.
6. Never reveal a person's home, movements or private contacts; stick to
   public, professional facts for a legitimate purpose.
7. Keep raw pulled data in /tmp; put only sourced findings in the report.
