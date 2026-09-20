# Examples

## Example 1: Successful Audit (UK FCA)

**Input Script (`script.txt`):**
> Hello, my name is Alex and I'm calling from Acme Financial Services. We would like to tell you about our loan products. There is no rush — please take whatever time you need to consider. If you would like to opt out of future calls, please let me know. Please note that your home may be at risk if you do not keep up repayments. We are authorised and regulated by the Financial Conduct Authority.

**Command:**
```bash
python3 scripts/audit_script.py --script script.txt --jurisdiction UK_FCA
```

**Output Excerpt:**
```json
{
  "jurisdiction": "UK_FCA",
  "overall_verdict": "PASS",
  "risk_level": "NONE",
  "fail_count": 0,
  "warn_count": 0
}
```

## Example 2: Failed Audit (High-Pressure Tactics)

**Input Script (`bad_script.txt`):**
> This is a limited-time offer that expires tonight. You'll get the best rate if you decide right now.

**Output Excerpt:**
```json
{
  "jurisdiction": "UK_FCA",
  "overall_verdict": "FAIL",
  "risk_level": "HIGH",
  "checks": [
    {
      "requirement_id": "FCA_CD_COMM_3",
      "requirement": "FCA Consumer Duty \u2014 No false urgency or artificial time pressure",
      "status": "FAIL",
      "suggested_rewrite": "This offer is available for a limited period. Please take whatever time you need to consider it carefully."
    }
  ],
  "flags": [
    "REQUIRES_LEGAL_REVIEW",
    "PRESSURE_TACTIC_DETECTED",
    "HIGH_COMPLIANCE_RISK"
  ]
}
```
