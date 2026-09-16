# Verification Examples

*Note: All phone numbers used in examples must use `<E164_PHONE>` or a controlled internal test number. Do not commit real numbers.*

This is a fictional, no-call walkthrough. The dialogue and extracted values below
are illustrative; no provider response or durable host receipt is supplied.

## Example: Verifying a Local Gig

**1. Input & Bounding**
* **Opportunity Claim:** "Graphic Designer needed for weekend event, 500 ZAR"
* **Approved Contact:** `<E164_PHONE>`
* **Bounded Questions:** 
  1. Is the graphic designer position still open? 
  2. Is the pay 500 ZAR as listed?

**2. Call Execution (CALL-E)**
* **Agent:** "Hello, I am calling to verify the graphic designer opportunity. Is the position still open?"
* **Contact:** "Yes, we are still looking."
* **Agent:** "Great. Can you confirm the pay is 500 ZAR for the weekend?"
* **Contact:** "Yes, that's correct."

**3. Structured Extraction**
```json
{
  "position_open": true,
  "confirmed_pay_zar": 500
}
```

**4. Downstream State (PKA)**
The structured extraction is passed downstream to the host application's reconciliation layer (e.g., PKA). 
An integrating host may label a supported claim `KNOWN` or a contradictory one `CONFLICTING`; these are advisory evidence labels, not proof of an employer's identity or offer validity. Persisting a masked verification receipt is the host's responsibility. Missing or ambiguous provider state remains `UNKNOWN` and stops further calls pending human reconciliation.
