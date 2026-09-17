# Research Papers — call-script-compliance-auditor

## Primary References (2025–2026)

### "Runtime Compliance Verification for AI Agents" (arXiv, 2026)
- Key finding: Policy-as-code predicate interception — monitoring AI agent tool calls and model outputs at runtime against formal policy predicates. Achieves deterministic compliance enforcement before actions are taken.
- Relevance: The architectural blueprint for the auditor's Policy-as-Code checking engine. Each rule in `audit_script.py` is a predicate in this sense.

### PrivaCI-Bench: Contextual Integrity for LLM Privacy Compliance (arXiv, 2025)
- Key finding: LLMs evaluated against GDPR and HIPAA privacy clauses can achieve up to 97.9% clause-level accuracy with hybrid symbolic-neural methods. Defines the benchmark for contextual integrity evaluation.
- Relevance: Validates that heuristic pattern matching + structured rule libraries can achieve high-precision compliance checking without full LLM inference.

### "Automated Regulatory Compliance Verification: Hybrid Rule-Based + XAI" (Semantic Scholar, 2025)
- Key finding: Hybrid symbolic-AI architectures combining deterministic rules with contextual models achieve 97.9% precision for regulatory compliance checking. XAI (explainable AI) provides audit-ready evidence for each verdict.
- Relevance: Justifies the hybrid approach used in this skill: deterministic pattern rules + structured evidence snippets for each check.

### "Compliance-to-Code: Decomposing Regulations into Logical Components" (arXiv, 2025)
- Key finding: Legal "shall/must/must not" clauses can be decomposed into subjects, conditions, and constraints, then mapped to executable verification predicates.
- Relevance: The requirement library in `audit_script.py` follows this decomposition pattern for each jurisdiction.

## Regulatory References

### EU AI Act — Articles 12, 13, 52
- Publisher: Official Journal of the European Union
- Signed: 2024, effective February 2025
- Article 12: Technical documentation and logging requirements
- Article 13: Transparency to natural persons — AI systems must communicate clearly and comprehensibly
- Article 52: Specific transparency obligations; prohibits certain emotional inferences in workplaces
- URL: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689

### FCA Consumer Duty Final Rules and Guidance — PS22/9
- Publisher: Financial Conduct Authority (UK)
- Date: July 2022 (enforced: July 2024)
- §4.21: Identity disclosure requirement
- §4.39(c): Prohibition on false urgency and pressure tactics
- §4.39(d): Prohibition on pressure to decide immediately
- §4.40: Opt-out mechanism requirement
- §4.55: Risk warnings for financial products
- URL: https://www.fca.org.uk/publication/policy/ps22-9.pdf

### TCPA — Telephone Consumer Protection Act, 47 U.S.C. § 227
- Publisher: U.S. Federal Communications Commission (FCC)
- §227(d)(3)(A): Caller identity and organisation at call start
- §227(b)(2)(C): Opt-out mechanism for automated calls
- §227(c): National Do Not Call Registry compliance
- 16 C.F.R. § 310.4(b): FTC Telemarketing Sales Rule — DNC compliance
- URL: https://www.fcc.gov/consumers/guides/stop-unwanted-robocalls-and-texts

### GDPR Articles 13 & 14 — European General Data Protection Regulation
- Publisher: Official Journal of the European Union
- Article 13(1)(a): Controller identity disclosure on data collection
- Article 13(1)(c): Purpose of processing disclosure
- Article 13(2)(a): Retention period or criteria
- Article 13(2)(c): Right to withdraw consent
- Article 7: Conditions for consent
- URL: https://gdpr-info.eu/art-13-gdpr/

### HIPAA Privacy Rule — 45 C.F.R. § 164.510
- Publisher: U.S. Department of Health and Human Services (HHS)
- §164.510(b): Permitted disclosures for involvement in individual's care
- §164.502(b): Minimum necessary standard
- §164.510(b)(3): Identity verification before PHI disclosure
- URL: https://www.hhs.gov/hipaa/for-professionals/privacy/laws-regulations/index.html
