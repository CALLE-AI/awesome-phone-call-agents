# Call scripts — plain English

Use when the shop owner prefers standard English, or for India pilots (`region: IN`).

## Morning inventory check-in

**Opening**

- "Good morning. Can we do a quick shop check-in?"
- "I'm calling from your shop manager service. Do you have a few minutes?"

**Disclosure**

- "I'm an AI assistant helping track your shop. This call may be recorded."

**Stock questions**

- "How many bags of rice do you have now?"
- "How many cartons of noodles are left?"
- "What is running low or almost finished?"
- "How much sugar is left?"
- "Do you still have enough cooking oil?"
- "Did you add any new goods we have not tracked before? What are they called, and roughly how many do you have?"

**New goods (probe once per morning call)**

- If the owner names a product that was not on the ask-list, capture it as a normal inventory line (name, quantity, unit). The ledger **adds** new product names automatically — do not refuse or ignore them.
- Ask unit and approximate quantity the first time a new good appears.
- Optional: "Who do you usually buy that from?" (for later vendor memory).

**Procurement hints**

- "Did you buy anything yesterday? From whom?"
- "Which supplier gave you a better price recently?"

**Closing**

- "Thank you. I'll note this and call later to check today's sales."
- Do **not** place vendor orders on this call yet unless a separate restock workflow with explicit yes is active (Phase 2).

## Evening sales recap

**Opening**

- "Good evening. How was business today?"

**Sales**

- "Roughly how much did you sell today?"
- "What sold best today?"
- "Did anything not move at all?"

**Purchases**

- "Did you buy anything for the shop today?"
- "About how much did you spend restocking?"
- "Who did you buy from?"

**Closing**

- "Thank you. I'll share a short summary once we have a few days of data."

## India variant notes

- Use `region: IN` and `locale: en` or `hi` per CALL-E supported languages.
- Currency in results: `INR`.
- For Hindi-English mix, use [`call-scripts-hindi-english.md`](./call-scripts-hindi-english.md)
  with `language_style: hindi-english` (see `assets/sample-shop-profile-inr.json`).

## Tone rules

Same as Pidgin scripts: accept approximations, one question at a time, no financial advice.

## Phase 2 — reorder offer (after low stock is flagged)

**Ask**

- "Fish and rice are running low. Would you like me to place an order?"
- If yes: "How much do you need?" then "Which vendor should I use?"
- If a vendor is already on file: "Should I use [vendor name] again, or someone else?"
- Never invent a vendor phone number — only save it if the owner states it.

**If no** — "No problem, I won't contact anyone." End the call. Do not save any vendor.

## Phase 2 — vendor order (calling the supplier)

**Opening**

- "Good day, I'm an AI assistant calling on behalf of [shop name]."
- "I'd like to place an order for [items]."

**Ask**

- "Do you have that available?"
- "What would that cost?" (optional — only if the vendor offers a price)
- "When could that reach the shop?"

**Never ask** — payment, bank details, or loans. This call is for the order only.

## Phase 2 — owner status callback

**Opening**

- "I have an update on your order."

**Message**

- "I placed the [item] order with [vendor name]. They said it should arrive around [ETA]."
- If the vendor was unavailable: "[Vendor name] doesn't have that right now. Would you like me to try someone else?"

**Closing**

- "I've noted everything. Thank you."

## Phase 2 — new-shop onboarding

**Opening**

- "Good day, I'm an AI assistant. I'll set up your shop account — a few quick questions."

**Collect**

- "What's your shop name, and phone number so I can confirm it?"
- "Which region and language do you prefer for calls?"
- "Tell me 3 to 5 things you mainly sell."
- "Do you have a regular supplier I should note?" (optional)

**Consent**

- "Do you agree we store this and call you later for check-ins?" — require a clear yes.

**Returning owner** — if the number is already on file: "Are you still [shop name], same number?" instead of the full onboarding.

## Phase 3 — payment consent (after order amount is known)

Use only after a vendor order exists with an amount. Separate call (or clearly separate turn) from the restock yes.

**Ask**

- "Mama Sikiru confirmed the fish for about ₦45,000. Do you want me to pay her that amount now?"
- Read back the **exact** amount and vendor name. Require an explicit yes or no.

**Never ask**

- Bank account number, BVN, NUBAN, card number, PIN, OTP, or USSD code
- To "send your password" or open a banking app during the call

**If yes** — record payment consent via `result-schema-payment-consent.json`; the app creates/approves a `payment_intent` and the fake (or later real) adapter pays offline.

**If no** — leave the intent draft/cancelled; do not submit a transfer.
