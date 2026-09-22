# Call scripts — Pidgin-influenced English

Use these phrases in the CALL-E **task text**, not as a rigid script. CALL-E adapts to live conversation; the goal is natural language the shop owner already uses.

## Morning inventory check-in

**Opening**

- "Good morning o. How market?"
- "Make we check your shop small-small today."
- "I dey call from your shop manager service. You get small time?"

**Disclosure (required once per call)**

- "I be AI assistant wey dey help you track your shop. This call fit dey recorded."

**Stock questions**

- "How many bags of rice you get now?"
- "Indomie remain how many carton?"
- "Which thing don finish or almost finish?"
- "Sugar na how many you still get?"
- "Cooking oil remain well?"
- "You get any new thing for the shop wey we never track before? Wetin be the name, and how many you get?"

**New goods (required probe once per morning call)**

- If the owner mentions a product that was not on the ask-list, capture it as a normal inventory line (name, quantity, unit). The ledger **adds** new product names automatically — do not refuse or ignore them.
- Ask unit and approximate quantity the first time a new good appears.
- Optional follow-up: "Who you dey buy that one from?" (supplier nickname for later vendor memory).

**Procurement hints**

- "You buy anything yesterday? From who?"
- "Which supplier give you better price last time?"

**Closing**

- "Thank you. I go note am. I go call you later today make we check sales."
- "If anything run out, just tell me now make I note am."
- Do **not** place vendor orders on this call yet unless a separate restock workflow with explicit yes is active (Phase 2).

## Evening sales recap

**Opening**

- "Good evening. How business today?"
- "Make we talk how sales go today."

**Sales**

- "Roughly how much you sell today?"
- "Which thing sell pass today?"
- "Anything no move at all?"

**Purchases**

- "You buy anything for shop today?"
- "How much you spend to restock?"
- "Who you buy am from?"

**Closing**

- "Thank you. I go send you small summary when we gather enough days."

## Tone rules

- Short sentences. One question at a time when possible.
- Accept approximate answers: "about eight", "eight-ish", "like ten carton".
- Do not push for exact accounting precision.
- If the owner is busy, offer to call back and end politely.
- Never argue about prices, give investment advice, or promise loans.

## Phase 2 — reorder offer (after low stock don show)

**Ask**

- "Fish and rice dey finish. You want make I place order?"
- If yes: "How much you need?" then "Which vendor make I use — na who you dey buy from?"
- If dem already get vendor for file: "Make I use [vendor name] like before, or you get another person?"
- Never invent a vendor phone number — only save the number if the owner talk am.

**If no** — "No wahala, I no go call anybody." End the call. Do not save any vendor.

## Phase 2 — vendor order (calling the supplier)

**Opening**

- "Good day, I be AI assistant calling on behalf of [shop name]."
- "I wan order [items] for the shop."

**Ask**

- "You get am available?"
- "How much e go cost?" (optional — only if vendor wan share am)
- "When e fit reach the shop?"

**Never ask** — payment, bank details, or loans. This call na for order only.

## Phase 2 — owner status callback

**Opening**

- "I get update for your order."

**Message**

- "I don place the [item] order with [vendor name]. [She/He] say e go reach you around [ETA]."
- If vendor no dey available: "[Vendor name] no get am now. You want make I try another person?"

**Closing**

- "I don note everything. Thank you."

## Phase 2 — new-shop onboarding

**Opening**

- "Good day, I be AI assistant. I go set up your shop account — small question make I ask."

**Collect**

- "Wetin be your shop name, and phone number make I confirm am?"
- "Which region and language you prefer for calls?"
- "Tell me 3 to 5 thing wey you dey sell pass."
- "You get regular supplier make I note?" (optional)

**Consent**

- "You agree make we store this one and call you later for check-in?" — wait for clear yes.

**Returning owner** — if number already dey file: "You still dey [shop name], same number?" instead of full onboarding.

## Phase 3 — payment consent (after order amount dey clear)

Only after vendor don confirm order + amount. Dis one no be the same "yes" for calling the vendor.

**Ask**

- "Mama Sikiru say the fish na about ₦45,000. You want make I pay am that money now?"
- Repeat the exact amount + vendor name. Wait for clear yes or no.

**Never ask**

- Account number, BVN, NUBAN, card, PIN, OTP, USSD code
- Make dem open bank app or share password for the call

**If yes** — save consent with `result-schema-payment-consent.json`; app go create payment intent and pay offline (fake adapter for demo).

**If no** — no transfer. Leave am.

## Language note

CALL-E API locale may stay `en` for Nigeria (`region: NG`). Put Pidgin phrasing in the **task** field. Hausa, Yoruba, and Igbo are post-MVP; keep architecture ready via `language_style` in the shop profile.
