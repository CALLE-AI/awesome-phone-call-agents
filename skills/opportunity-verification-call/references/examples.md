# Verification Examples

*Note: All phone numbers used in examples must use `<E164_PHONE>` or a controlled internal test number. Do not commit real numbers.*

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
If the evidence is sufficient, the state resolves to `KNOWN`. If the contact contradicted the pay, it would resolve to `CONFLICTING`. This governed state is output as a durable verification receipt.