# OSINT report template

Lead with target, purpose and method, then findings, then the confidence map,
gaps and sources. Plain bullets (no tables in chat). Every non-obvious claim
cites a source. Keep raw pulls in /tmp; only sourced findings go here.

---

**OSINT: {target}**
*{one-line summary of what was found}*

**Scope**
- Target: {domain / company / account / own footprint}
- Purpose: {own footprint | authorized infra | entity due diligence | verification}
- Authorization: {owner's own asset | authorized by {who} | public entity, public data}
- Date: {date}. Method: {tools used; what was missing}.

**Findings**
Group by what fits the target. For infrastructure: hosting, DNS, subdomains,
certificates, exposed services. For an entity: who runs it, where it is hosted,
public track record, products, presence. For a person (public due diligence):
confirmed identity, current public role, verifiable work history, public
profiles. Each bullet ends with its source and grade, e.g.:
- {fact} - {source} [A]

**Confidence map**
- A (confirmed, 2+ sources or official): {facts}
- B (probable, 1 credible source): {facts}
- C (inferred): {facts}
- D (unverified): {facts}
- Contradictions: {any facts where sources disagree, both kept}

**Gaps**
- {what could not be established, and why}

**Sources**
- {source 1 - url / registry / record}
- {source 2}

**Metrics**
- Coverage: {which purpose questions were answered}
- Source types: {count and list}
- Cycles: {how many research passes}
