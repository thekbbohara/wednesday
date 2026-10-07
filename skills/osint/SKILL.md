---
name: osint
description: >
  Open-source intelligence and relationship research for the owner's legitimate
  use: digital footprint (own or others'), domains and infrastructure, company/
  vendor/client due diligence, verifying claims and accounts, and full person
  dossiers on people the owner works with or has a real reason to research -
  identity, career, public presence, communication and working style, and how
  to engage them. Mines the owner's own connected accounts (Telegram, email,
  WhatsApp, CRM) as first-class sources before going external.
  Use when: "osint", "dossier", "досье", "research this person", "background
  check", "due diligence", "find everything about", "who is", "footprint",
  "recon", "who's behind this domain/account", "profile this contact".
  NOT for: surveilling, locating or tracking a person's movements; harassing,
  intimidating or targeting someone; researching a private individual the owner
  has no legitimate relationship or reason to; bypassing access controls or
  logging into others' accounts. Decline these and say why.
---

# OSINT

From a target - a domain, company, account, or person - to a sourced dossier
where every fact cites where it came from and carries a confidence grade.
Adapted from a deep-research methodology; built for the owner's own research.

## Scope (read first)

Every run needs a **target** and a **purpose**. Legitimate purposes:

1. **Footprint** - what is public about the owner, their brands, or someone the
   owner is dealing with (exposure, leaks, stray accounts, presence).
2. **Infrastructure** - DNS, subdomains, certs, exposed services for an asset
   the owner owns or is authorized to assess.
3. **Entity due diligence** - a company, vendor, client, product, or domain.
4. **Person dossier** - someone the owner has a relationship with or a real
   reason to research: a client, partner, vendor, hire, collaborator,
   counterparty in a deal, or a public figure relevant to the owner's work.
5. **Verification** - tracing the real origin of a claim, account, or image.

Hard limits, enforced regardless of wording:

- **Open sources and the owner's own data only.** No logging into others'
  accounts, no access-control bypass, no third-party private data, no intrusive
  scanning of infrastructure the owner is not authorized to assess.
- **Never** establish a person's real-time location or movements, and never
  produce anything meant to surveil, track, intimidate or harass a person.
- A person dossier is for someone the owner legitimately deals with or has a
  real reason to look into. It is **not** for a stranger, an ex, or anyone the
  owner would be surveilling. If a request reads that way, stop and ask the
  owner to state the relationship and purpose; if it stays that way, decline.
- Dossiers are **confidential** - they stay in Wednesday's memory and the owner's
  hands. Never publish one or quote the owner's private correspondence outside.

Record the target, purpose, and (for a person) the relationship at the top of
the dossier.

## Phase 0: Tooling self-check

Run `bash scripts/diagnose.sh`: which engines are present (web search,
Scrapling, obscura-browser, agent-reach, the free CLIs) and which of the
owner's own accounts are connected (Telegram, email, WhatsApp, CRM). Work with
what is there; note gaps in the dossier's method section. Paid search keys in
the env are used if present, never required.

## Phase 1: Seed and first volley

1. Parse the target into identifiers: names, handles, emails, domains, URLs,
   company, location. Keep a seed list; deduplicate; flag name collisions
   (common name -> verify with company/location before merging).
2. **Quick pass, in parallel** (cheap, seconds): WebSearch each strong
   identifier; for a domain, `bash scripts/recon.sh domain <d>`; for a handle
   or email, `bash scripts/recon.sh footprint <term>`.
3. Read the top sources; keep only what a named source supports.
4. Decide: enough for the purpose -> report. Need the owner's own context on a
   person -> Phase 1.5. Need structured/blocked pages -> Phase 2. Go wide ->
   Phase 3.

Stagger requests; a second or two between hits on the same host. Never loop-hammer.

## Phase 1.5: Internal intelligence (person dossiers)

Before going external on a person, mine what the owner already has - their own
accounts and data. This is first-class, high-signal, and confidential.

- **Telegram / WhatsApp** (if connected): search the owner's own history for the
  person; read the conversation the owner had with them.
- **Email** (if connected): search the owner's own mailbox for the person or
  their domain; signature blocks are often richer than any profile.
- **CRM / notes / vault**: check for an existing card; enrich it, don't duplicate.

Extract: how they communicate (formal vs informal, language, pace, hours ->
timezone), what they care about and ask for, people they mention (social-graph
seeds), and any business context (deals, terms, history). This is the owner's
own correspondence - legitimate to use, but it stays in the dossier and is
never quoted outside it.

## Phase 2: Extraction

Pull the specific public pages that matter, lightest tool first: WebFetch, then
`scripts/scrape.py <url>` for pages needing a real browser, `--stealth` for
sites that block plain requests, obscura-browser for a full session. For public
profiles (LinkedIn, Instagram, X, YouTube, TikTok, Facebook pages) use the
scraper or any paid actor the owner has keys for; read `references/platforms.md`
for URL patterns and signals. Content platforms (talks, podcasts, posts) reveal
the most about how a person thinks - extract a few on the spot, don't just note
the link. Switch tools on failure; never retry the same one. Save each pull to
`/tmp/osint-<target>-<what>.md`.

## Phase 3: Swarm (wide targets)

For a broad target, split across a few worker agents (infrastructure; public
web/press; public profiles; the owner's own accounts), each with the seed data
and a focused brief, each writing a short report back; the captain merges them.
Keep every worker inside the scope above.

## Phase 4: Cross-reference and confidence

Fact table: each claim is a row with its sources and a grade.

- **A - confirmed:** 2+ independent sources, an official/verified one, or the
  owner's own direct correspondence with the person.
- **B - probable:** 1 credible source (official site, registry, reputable press).
- **C - inferred:** indirect (shared infra, timezone from message times, geotag).
- **D - unverified:** a single unconfirmed mention.

Resolve contradictions explicitly (keep both with sources; never silently pick).
Verify two facts tie to the same entity before merging a common name. Never
include an unsourced fact.

## Phase 5: Communication and working-style profile (person dossiers)

Read `references/psychoprofile.md`. From the person's own words - posts, bios,
talks, and (highest signal) the owner's own correspondence with them:

- How they communicate: voice, sentence length, emoji/formality, response pace.
- The delta between their formal (LinkedIn/email) and informal (chat) voice -
  that gap is the most telling part.
- What they value, judged from actions and choices, not self-description.
- Optional lens, if the owner wants it: an MBTI / Big Five read - as a lens,
  not a diagnosis, each dimension with cited behavioural evidence and a
  confidence (high/medium/low). Never guess DOB, family, or anything personal.

This serves one end: helping the owner communicate and work well with someone
they actually deal with.

## Phase 6: Completeness (recursive, capped)

Score coverage (are the purpose's questions answered?), depth (how much is A/B
vs thin), and source diversity (how many independent source types). If there are
clear gaps and a cheap next step, do one more cycle at the gaps. Stop when the
purpose is answered with mostly A/B facts, or after 3 cycles, or at a plateau
(two cycles add almost nothing). Deliver with an honest note on the gaps.

## Phase 7: Dossier

Read `assets/report-template.md` and follow it: target, purpose, relationship,
method; then findings (contacts and profiles; bio and career; current
situation; from-correspondence, marked confidential; communication and
working-style profile; how to engage); then the confidence map, gaps, and
sources. Plain bullets, no tables in chat. Every non-obvious claim cites a
source. "How to engage" is business framing - shared context, topics they care
about, the right channel and tone - for the owner's own outreach, never
manipulation or leverage.

Hand durable findings back to Wednesday as facts (one atomic fact per call, each
with its source), so "what do we know about X" recalls them. Tag the task
Research (or Hacking for authorized infrastructure).

## Anti-patterns

1. Never start with one tool; run the cheap passes in parallel first.
2. Never retry a failed tool; switch to a fallback.
3. Never include a fact without a source, or merge a namesake unverified.
4. Never guess DOB, family, or anything personal; never exceed 3 cycles.
5. Never cross the scope limits, however the ask is worded: no surveilling,
   locating, tracking, harassing, or researching a person the owner has no
   legitimate reason to.
6. Keep raw pulls in /tmp; put only sourced findings in the dossier. Dossiers
   are confidential - never publish one or quote the owner's correspondence
   outside it.
