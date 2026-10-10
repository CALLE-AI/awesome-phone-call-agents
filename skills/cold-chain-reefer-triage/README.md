# Cold Chain Reefer Triage Agent (`cold-chain-reefer-triage`)

Advisory voice-telephony triage agent skill for refrigerated freight logistics, powered by the **CALL-E Python SDK (`calle-ai`)** and **Pydantic V2**.

Designed for [`CALLE-AI/awesome-phone-call-agents`](https://github.com/CALLE-AI/awesome-phone-call-agents).

---

## Highlights

- **No-Call Default**: Safe dry-run simulation mode is active by default; outbound calls require explicit authorization (`--live` or `live=True`).
- **E.164 & HTTPS Validation**: Validates phone numbers strictly and enforces encrypted HTTPS endpoints.
- **Privacy Masking**: Automatically masks driver destination phone numbers across logs (`+1303***0147`).
- **Advisory Scope**: Extracts structured mechanical checks, cargo condition, and FMCSA HOS drive time for human dispatch review.
- **Zero-Redial**: Enforces exactly one call attempt; dropped or busy calls route to human dispatch rather than looping.

---

## Quickstart

```bash
# 1. Install dependencies
pip install calle-ai pydantic

# 2. Run in dry-run mode (no credentials needed)
python scripts/run_triage.py --phone +13035550147

# 3. Run with live authorization
export CALLE_API_KEY="your-calle-key"
python scripts/run_triage.py --phone +13035550147 --live
```

---

## Documentation

- [Skill Specification & Schema](SKILL.md)
- [Safety Rules](references/safety.md)
- [Operational Limits & Failure Modes](references/operational-limits.md)
- [Usage Examples](references/examples.md)
- [Long-Form Architectural Guide](../../docs/cold-chain-reefer-triage/README.md)
