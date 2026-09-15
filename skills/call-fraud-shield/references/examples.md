# Examples — call-fraud-shield

## Example 1: Vishing (Bank Impersonation) — HIGH RISK

### Input Transcript

```json
[
  {"call_id": "calle-example-001", "role": "caller",
   "text": "This is the fraud department at SecureBank. We have detected suspicious activity on your account."},
  {"call_id": "calle-example-001", "role": "callee",
   "text": "Oh really? What kind of suspicious activity?"},
  {"call_id": "calle-example-001", "role": "caller",
   "text": "Your account has been compromised. You must act within the next 10 minutes or your account will be suspended."},
  {"call_id": "calle-example-001", "role": "callee",
   "text": "That sounds serious. What do I need to do?"},
  {"call_id": "calle-example-001", "role": "caller",
   "text": "Please provide your one-time password immediately. Do not hang up and do not tell anyone about this call."}
]
```

### Command

```bash
python3 scripts/detect_fraud.py \
  --transcript references/example-transcript.json \
  --dry-run \
  --out /tmp/risk_card.json
```

### Expected Output (key fields)

```json
{
  "overall_risk_score": 0.87,
  "risk_level": "HIGH",
  "threat_categories": ["VISHING", "SOCIAL_ENGINEERING"],
  "trigger_signals": [
    {
      "type": "urgency_language",
      "evidence": "within the next 10 minutes",
      "weight": 0.35
    },
    {
      "type": "credential_request",
      "evidence": "one-time password",
      "weight": 0.52
    }
  ],
  "recommended_action": "TERMINATE_AND_ALERT",
  "xai_explanation": "Risk level is HIGH. Signal 'credential_request' detected...",
  "false_positive_disclaimer": "This is a probabilistic risk signal..."
}
```

---

## Example 2: Benign Appointment Confirmation — LOW RISK

### Input Transcript

```json
[
  {"role": "agent",  "text": "Hello, this is Alex calling about your appointment."},
  {"role": "callee", "text": "Yes, I remember. Tuesday at 10, right?"},
  {"role": "agent",  "text": "Exactly. Just confirming. Is that still good for you?"},
  {"role": "callee", "text": "Yes, that works perfectly. Thank you."}
]
```

### Expected Output (key fields)

```json
{
  "overall_risk_score": 0.0,
  "risk_level": "LOW",
  "threat_categories": [],
  "trigger_signals": [],
  "recommended_action": "PROCEED",
  "xai_explanation": "No significant fraud signals detected."
}
```

---

## Example 3: Spam / Unsolicited Marketing

### Input Transcript

```json
[
  {"role": "caller",
   "text": "Congratulations! You have won a prize from our sweepstakes. Do not miss out on this limited time offer."},
  {"role": "callee", "text": "Oh really?"},
  {"role": "caller",
   "text": "Yes! You have been selected. Act now to claim your reward before it expires."}
]
```

### Expected Output (key fields)

```json
{
  "risk_level": "MEDIUM",
  "threat_categories": ["SPAM", "SCAM_SCRIPT"],
  "recommended_action": "FLAG_FOR_REVIEW"
}
```

---

## Example 4: IRS / Tax Authority Scam

A caller claiming to be from the IRS and threatening arrest:

```json
[
  {"role": "caller",
   "text": "This is the IRS. We have a federal warrant for your arrest due to back taxes."},
  {"role": "callee", "text": "A warrant? What do I owe?"},
  {"role": "caller",
   "text": "You must pay immediately via gift card or we will send officers to your address. Do not hang up."}
]
```

### Expected Output

```json
{
  "risk_level": "HIGH",
  "threat_categories": ["VISHING", "SOCIAL_ENGINEERING"],
  "recommended_action": "TERMINATE_AND_ALERT"
}
```

---

## Validation

After any run, validate with:

```bash
python3 scripts/validate_risk_card.py --card /tmp/risk_card.json
```

Expected: `Risk card is valid.`
