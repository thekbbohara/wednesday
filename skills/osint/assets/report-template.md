# OSINT report / dossier template

Lead with target, purpose, relationship and method, then findings, then the
confidence map, gaps and sources. Plain bullets (no tables in chat). Every
non-obvious claim cites a source. Keep raw pulls in /tmp; only sourced findings
go here. A person dossier is confidential: it stays with the owner.

Use the sections that fit. Infrastructure/entity targets use the top half;
person dossiers use all of it.

---

**OSINT: {target}**
*{one-line summary of what was found}*

**Scope**
- Target: {domain / company / account / person}
- Purpose: {footprint | infrastructure | entity due diligence | person dossier | verification}
- Relationship (person): {client / partner / vendor / hire / counterparty / public figure in a deal}
- Authorization: {owner's asset | authorized by {who} | public entity, public data | owner's own contact}
- Date: {date}. Method: {tools used; own accounts checked; what was missing}.

**Contacts and profiles**
- {channel / platform}: {handle or url} [{grade}]

**Findings**
Infrastructure: hosting, DNS, subdomains, certs, exposed services (authorized).
Entity: who runs it, where hosted, track record, products, presence.
Person - bio and career:
- date of birth: {only if confirmed A/B}
- education: {...}
- **{year}** - {role}, {company}
- **now** - {current role}, {current company}; location {...}
Each bullet ends with its source and grade: - {fact} - {source} [A].

**From correspondence** (confidential - owner's own data, never shared outside)
- how they communicate: {formal/informal, language, pace, hours}
- context: {cold / warm / existing business; history; terms discussed}
- people mentioned: {social-graph seeds}

**Communication and working-style profile**
- voice and style: {sentence length, formality, emoji; formal vs informal delta}
- values (from actions): {...}
- optional MBTI/Big Five lens: {type/trait} ({confidence}) - {cited evidence}

**How to engage** (for the owner's own outreach - channel, tone, shared context; not leverage)
- {the right channel and tone}
- {shared context or topics they care about}

**Confidence map**
- A (confirmed): {facts}  B (probable): {facts}  C (inferred): {facts}  D (unverified): {facts}
- Contradictions: {facts where sources disagree, both kept}

**Gaps**
- {what could not be established, and why}

**Sources**
- {source - url / registry / record / own account}

**Metrics**
- Coverage: {purpose questions answered}. Source types: {count and list}. Cycles: {n}.
