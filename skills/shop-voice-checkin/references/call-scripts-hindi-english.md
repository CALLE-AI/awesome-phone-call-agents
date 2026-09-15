# Call scripts — Hindi-English (Hinglish)

Use when the shop owner prefers a Hindi-English mix (`region: IN`,
`language_style: hindi-english`). Put these phrases in the CALL-E **task**
text; CALL-E adapts to live conversation.

Prefer `locale: hi` when the CALL-E account supports Hindi speech, otherwise
`locale: en` with this Hinglish task text. Currency in results: **INR**.

## Morning inventory check-in

**Opening**

- "Namaste. Aaj shop ka chhota sa check-in kar lein?"
- "Main aapke shop manager service se call kar raha hoon. Thoda time hai?"

**Disclosure (required once per call)**

- "Main AI assistant hoon, aapke shop ko track karne mein madad ke liye. Yeh call record ho sakti hai."

**Stock questions**

- "Abhi chawal kitne kilo bache hain?"
- "Atta kitna bacha hai?"
- "Kaun si cheez khatam hone wali hai?"
- "Cooking oil theek se bacha hai?"
- "Koi nayi cheez add ki hai jo pehle list mein nahi thi? Naam kya hai, aur roughly kitna hai?"

**New goods (probe once per morning call)**

- If the owner names a product that was not on the ask-list, capture it as a
  normal inventory line (name, quantity, unit). The ledger **adds** new product
  names automatically — do not refuse or ignore them.
- Ask unit and approximate quantity the first time a new good appears.
- Optional: "Woh usually kahan se lete ho?" (supplier nickname for later vendor memory).

**Procurement hints**

- "Kal kuch kharida tha? Kis se?"
- "Kaunse supplier ne recently better rate diya?"

**Closing**

- "Dhanyavaad. Main note kar leta hoon. Shaam ko sales ke liye call karunga."
- Do **not** place vendor orders on this call unless a separate restock
  workflow with explicit yes is active (Phase 2).

## Evening sales recap

**Opening**

- "Namaste. Aaj business kaisa raha?"

**Sales**

- "Aaj roughly kitna becha?"
- "Sabse zyada kya chala?"
- "Kuch bilkul nahi chala?"

**Purchases**

- "Aaj shop ke liye kuch kharida?"
- "Restock pe roughly kitna kharcha hua?"
- "Kis se liya?"

**Closing**

- "Dhanyavaad. Kuch din ka data milne ke baad chhota summary share karunga."

## Tone rules

- Short sentences. One question at a time when possible.
- Accept approximations: "lagbhag aath", "das kilo ke around", "thoda kam".
- Do not push for exact accounting precision.
- If the owner is busy, offer to call back and end politely.
- Never argue about prices, give investment advice, or promise loans.
- Mix Hindi and English the way the owner speaks; do not force pure Hindi.

## Phase 2 — reorder offer (after low stock is flagged)

**Ask**

- "Machhli aur chawal kam pad rahe hain. Order place karwaoon?"
- If yes: "Kitna chahiye?" then "Kaunsa vendor use karoon?"
- If a vendor is already on file: "Pehle wala [vendor name] theek hai, ya koi aur?"
- Never invent a vendor phone number — only save it if the owner states it.

**If no** — "Theek hai, kisi ko call nahi karunga." End the call. Do not save any vendor.

## Phase 2 — vendor order (calling the supplier)

**Opening**

- "Namaste, main AI assistant hoon, [shop name] ki taraf se call kar raha hoon."
- "Order place karna hai: [items]."

**Ask**

- "Yeh available hai?"
- "Kitna lagega?" (optional — only if the vendor offers a price)
- "Kab tak shop pe pahunch sakta hai?"

**Never ask** — payment, bank details, UPI secrets, or loans. This call is for the order only.

## Phase 2 — owner status callback

**Opening**

- "Aapke order ka update hai."

**Message**

- "Maine [item] ka order [vendor name] se place kar diya. Unhone kaha [ETA] tak aa jayega."
- If the vendor was unavailable: "[Vendor name] ke paas abhi nahi hai. Kisi aur ko try karoon?"

**Closing**

- "Sab note kar liya. Dhanyavaad."

## Phase 2 — new-shop onboarding

**Opening**

- "Namaste, main AI assistant hoon. Shop account set up karunga — chhote sawaal."

**Collect**

- "Shop ka naam kya hai, aur phone number confirm karne ke liye?"
- "Kaunsa region aur language prefer karte ho calls ke liye?"
- "Teen se paanch cheezein batao jo aap zyada bechte ho."
- "Koi regular supplier note karoon?" (optional)

**Consent**

- "Kya aap agree karte ho ki hum yeh store karein aur baad mein check-in calls karein?" — require a clear yes.

**Returning owner** — if the number is already on file: "Aap abhi bhi [shop name] ho, same number?" instead of the full onboarding.

## Phase 3 — payment consent (after order amount is known)

Use only after a vendor order exists with an amount. Separate call (or clearly
separate turn) from the restock yes.

**Ask**

- "Sharma Ji ne machhli ke liye lagbhag ₹4,500 confirm kiye. Kya main unko itna abhi pay kar doon?"
- Read back the **exact** amount and vendor name. Require an explicit yes or no.

**Never ask**

- Bank account number, IFSC, UPI PIN, card number, OTP, or netbanking password
- To open a banking app or share credentials during the call

**If yes** — record payment consent via `result-schema-payment-consent.json`;
the app creates/approves a `payment_intent` and the fake (or later real)
adapter pays offline.

**If no** — leave the intent draft/cancelled; do not submit a transfer.

## Language note

CALL-E India (`region: IN`) supports local lines. Put Hinglish phrasing in the
**task** field. Keep `language_style: hindi-english` on the shop profile so
agents pick this reference over the plain English or Pidgin scripts.
