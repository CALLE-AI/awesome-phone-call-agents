# QuoteHunter Skill Examples

Representative operational examples, end-to-end conversation transcripts, and structured result schemas. All phone numbers use reserved fictional ranges (`+1-555-0100` to `+1-555-0199`).

## Safe

- Operator dispatches parallel quote calls to three verified local contractors who have publicly advertised their trade services.
- Operator previews target numbers, project requirements, and task instructions in pre-flight modal before dialing.
- Operator uses the 3-second cancellation buffer to abort an unintended dispatch before telecom carriers are engaged.
- System extracts structured estimates and verbatim spoken evidence into a side-by-side comparison matrix.
- System requires human confirmation before unmasking vendor contact details and initiating closing communications.
- Running against simulated provider endpoints without consuming telecom minutes.

## Unsafe

- Robocalling unverified consumer numbers without consent.
- Placing automated calls to emergency, medical, or government agency numbers.
- Committing to binding contracts, authorizing work, or paying invoices over the phone without human authorization.
- Storing unencrypted API keys or plain-text credentials in client-side storage.
- Fabricating price quotes when a vendor did not answer or declined to provide an estimate.

---

## Worked Example 1: Successful Rate Discovery & Negotiation (Painting)

### Target Contractor
- **Vendor:** Apex Home Finishers
- **Phone:** `+1-555-0100`
- **Scope:** 2BHK 950 sq ft interior repaint with primer

### Real-Time Call Transcript

```text
[Carrier Connected] Phone ringing...
[Provider Answers]
Contractor: "Apex Finishers, Ramesh speaking."

QuoteHunter AI: "Hi Ramesh! I'm calling about a painting job for a client in your area. I'm an automated assistant gathering quick estimates — do you have a quick minute for a ballpark quote?"

Contractor: "Yeah, sure. What is the work?"

QuoteHunter AI: "It's a 2BHK interior repaint, about 950 square feet in Indiranagar. The client wants two coats plus primer. What would your ballpark estimate be for labor and materials?"

Contractor: "Okay, for 950 square feet with primer and Asian Paints Royale, standard rate is about 10,500 rupees total."

QuoteHunter AI: "Got it, 10,500 rupees. How soon could your crew start, and how many days would it take?"

Contractor: "We can start this Thursday. It will take two days, done by Friday evening."

QuoteHunter AI: "Understood. Is that your best quote, or is there any flexibility on that estimate?"

Contractor: "If the client confirms by tomorrow, I can do 9,500 rupees all inclusive."

QuoteHunter AI: "Thank you so much for the details, Ramesh. I've noted this down for the customer, and they'll reach out directly to confirm next steps. Have a great day!"

Contractor: "Sure, thank you. Bye."
[Call Completed - Duration: 58s]
```

### Extracted Structured Schema Result

```json
{
  "quote_provided": "yes",
  "price_estimate": "₹9,500",
  "price_numeric": 9500,
  "availability": "Starts this Thursday, 2 days turnaround",
  "additional_conditions": "Includes Asian Paints Royale; ₹1,000 discount applied for quick confirmation",
  "provider_notes": "₹7,000 labor + ₹2,500 materials with 2-day turnaround.",
  "evidence": "\"If the client confirms by tomorrow, I can do 9,500 rupees all inclusive.\""
}
```

---

## Worked Example 2: Fail-Closed Scope Handling (Declined / Unavailable)

### Target Contractor
- **Vendor:** Rapid Touch Paints
- **Phone:** `+1-555-0102`
- **Scope:** 2BHK 950 sq ft interior repaint with primer

### Real-Time Call Transcript

```text
[Carrier Connected] Phone ringing...
[Provider Answers]
Contractor: "Hello, Rapid Touch."

QuoteHunter AI: "Hi! I'm calling about a painting job for a client in Indiranagar. I'm an automated assistant gathering quick estimates — do you have a quick minute for a ballpark quote?"

Contractor: "Look, we are completely fully booked until next month. We're not taking any new jobs right now."

QuoteHunter AI: "Understood, thank you for letting me know. Have a wonderful day!"
[Call Completed - Duration: 18s]
```

### Extracted Structured Schema Result (Zero Hallucination)

```json
{
  "quote_provided": "no",
  "price_estimate": "not_provided",
  "price_numeric": 0,
  "availability": "not_discussed",
  "additional_conditions": "Fully booked until next month",
  "provider_notes": "Contractor declined to quote due to full project capacity.",
  "evidence": "\"We are completely fully booked until next month. We're not taking any new jobs right now.\""
}
```
