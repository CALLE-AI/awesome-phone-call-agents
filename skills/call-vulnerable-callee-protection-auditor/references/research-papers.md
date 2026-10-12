# Research Papers — call-vulnerable-callee-protection-auditor

This skill is grounded in the following official and peer-reviewed sources.
Every citation below has been checked to exist; no unverified references are
included. The skill remains an offline lexical heuristic: the sources motivate
its design, they do not validate its output.

---

## 1. Mechanism evidence: confusion markers co-occur with exploitation vulnerability

### Hall, L., Rorai, V., & Lichtenberg, P. A. (2025). "The association between early memory loss, financial exploitation, and financial exploitation vulnerability." Alzheimer's & Dementia: Behavior & Socioeconomics of Aging, 1(1), e70001. doi:10.1002/bsa3.70001
- **Source**: Wayne State University; cross-sectional study, N=150, NIH-funded.
  https://doi.org/10.1002/bsa3.70001
- **Relevance**: Establishes that confusion/memory markers co-occur with
  financial exploitation vulnerability — the empirical basis for this skill's
  marker-to-exploitation window design: a struggle marker opens an observation
  window, and agent conduct *inside* that window is what gets audited.
- **Venue correction note**: This paper appears in the *Behavior &
  Socioeconomics of Aging* sister journal of Alzheimer's & Dementia, **not**
  the flagship *Alzheimer's & Dementia* journal. Misattribution to the flagship
  venue is common; cite the sister journal.

## 2. Empirical scale: why single-call conduct auditing matters

### FBI Internet Crime Complaint Center (IC3) (2024). "Elder Fraud, in Focus"
- **Source**: FBI news story, published 2024-04-30.
  https://www.ic3.gov/crimeinfo/elderfraud (program page, verified live)
- **Relevance**: Scams against adults 60+ caused over $3.4 billion in reported
  losses in 2023, roughly 11% up from 2022. This is the scale argument for
  auditing agent conduct call-by-call rather than relying on after-the-fact
  victim reporting.

## 3. Normative official: current regulatory attention

### Federal banking agencies (FRB, CFPB, FDIC, NCUA, OCC). "Interagency Statement on Elder Financial Exploitation."
- **Source**: Issued 2024-12-04 (FDIC FIL-83-2024; FRB SR 24-8); revised 2026
  (reputational-risk references removed; NCUA page dated 2026-05-08). The PDF
  "Interagency-Statement-on-EFE-FINAL-508C.pdf" is listed on fincen.gov
  guidance pages.
- **Relevance**: Drives the skill's `review_action` escalation language and
  demonstrates that elder financial exploitation response remains an active,
  current regulatory expectation for institutions.

## 4. Method anchor: behavioral red-flag taxonomy

### FinCEN (2022). "Supplemental Advisory on Elder Financial Exploitation"
- **Source**: Issued 2022-06-15 for World Elder Abuse Awareness Day. fincen.gov
- **Relevance**: Source of the behavioral red-flag concept, adapted here to
  conversational markers (confusion, disorientation, hearing pleas, reliance
  transfer) rather than transaction-level red flags.
- **Honesty note**: 2022 vintage. Recency for this skill is carried by the
  2026-revised Interagency Statement above. The URL is soft-pinned: title,
  date, and domain are verified, but the direct PDF link was not surfaced at
  verification time.

---

## Corrections and honesty notes

- The struggle markers this skill detects are **heuristic conversation
  proxies**. They are NOT a cognitive assessment of the callee, and a verdict
  is NOT a determination of consent validity or capacity. No clinical or legal
  conclusion follows from any output of this skill.
- This skill explicitly does NOT duplicate
  [call-cognitive-load-monitor](../../call-cognitive-load-monitor/), which
  estimates callee state (advisory); this skill audits what the AGENT did in
  those moments — the two compose.
