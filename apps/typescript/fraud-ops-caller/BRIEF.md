# CALL-E · Fraud Ops Caller — locked brief (2026-09-09)

**Hackathon:** [CALL-E: Your Code Is Calling](https://call-e.devpost.com/) — deadline **2026-09-14 23:45 HKT**  
**Product name (working):** Fraud Ops Caller (`fraud-ops-caller`)  
**One-liner:** Risk case fires → AI places a real phone call (KYC, collections, merchant, or **both-party evidence**) → structured outcome writes back; humans only on rails.

We do **not** claim hosted ML recovery engines, consortium data, or chargeback CRM. Voice is the execution layer; decisioning stays upstream (Tarka-shaped case or mock).

---

## Demo lead

1. **KYC chase** (film first — clear, low-creepy)  
2. Collections (mode switch)  
3. Merchant outreach (mode switch)  
4. **Evidence collection** (mode switch — both parties, safety-aware)

Same runtime, four intents.

---

## Case payload (in)

```json
{
  "case_id": "case_demo_kyc_001",
  "intent": "kyc_chase | collections | merchant_outreach | evidence_collection",
  "pack_fired": "kyc.docs_incomplete",
  "reason_plain": "Selfie passed; government ID expired and proof of address missing.",
  "contact": {
    "name": "Alex Example",
    "phone_e164": "+12125550101",
    "role": "customer | counterparty | authorized_merchant_contact | complainant | respondent",
    "locale": "en-HK"
  },
  "context": {
    "missing_docs": ["government_id", "proof_of_address"],
    "amount_due": null,
    "currency": null,
    "days_late": null,
    "merchant_name": null,
    "risk_flags": [],
    "party": "complainant | respondent | merchant | customer",
    "safety_sensitive": false,
    "incident_summary_plain": null,
    "counterpart_case_id": null
  },
  "deep_links": {
    "upload": "https://example.test/kyc/upload?c=case_demo_kyc_001",
    "pay": null,
    "portal": null,
    "evidence_share": null
  },
  "policy": {
    "attempt_n": 1,
    "max_attempts": 3,
    "quiet_hours_local": ["21:00", "09:00"],
    "allow_ptp": false,
    "allow_pay_link_sms": false
  },
  "callback_url": "https://our-demo.test/webhooks/call-outcome"
}
```

Collections fills `amount_due` / `days_late` / `deep_links.pay`.  
Merchant fills `merchant_name` / `risk_flags` / `contact.role=authorized_merchant_contact`.

---

## Outcome payload (out)

```json
{
  "case_id": "case_demo_kyc_001",
  "intent": "kyc_chase",
  "call_id": "calle_…",
  "recording_id": "rec_…",
  "disposition": "uploading_now",
  "quotes": ["I'll upload the ID tonight"],
  "next_action": "watch_upload_24h",
  "fields": {
    "ptp_date": null,
    "missing_docs": ["government_id", "proof_of_address"],
    "callback_at": null,
    "contact_role": "customer",
    "handoff_reason": null
  },
  "transcript_snippet": "…",
  "ended_at": "2026-09-14T12:00:00Z"
}
```

### Disposition enums

| Intent | Dispositions |
|---|---|
| collections | `paid` \| `ptp` \| `refuse` \| `wrong_party` \| `voicemail` \| `no_answer` \| `handoff` |
| kyc_chase | `uploading_now` \| `callback` \| `confused` \| `refuse` \| `voicemail` \| `no_answer` \| `handoff` |
| merchant_outreach | `reached` \| `docs_promised` \| `wrong_contact` \| `voicemail` \| `no_answer` \| `handoff` |
| evidence_collection | `statement_taken` \| `will_upload` \| `refused` \| `unsafe_escalate` \| `wrong_party` \| `voicemail` \| `no_answer` \| `handoff` |

---

## CRM / CMS tie-back

| System | Owns | We read | We write |
|---|---|---|---|
| **Case / CMS** (Tarka-shaped mock, ServiceNow, SF Case) | risk reason, pack_fired, status, audit | case open → trigger | status, activity, disposition, recording URL, handoff assignee |
| **CRM / LMS / onboarding** | phone, docs missing, balances | contact + deep links | PTP date, last_touch, attempt_n |

**Trigger automation when**

- Case status ∈ `{needs_kyc, past_due, merchant_review}` AND attempt_n < max_attempts AND outside quiet hours AND consent/TCPA flag ok  
- Webhook `case.updated` or nightly queue poll (demo: button “Call now”)

**Hand to human when**

- Identity fail / “not me” / wrong party confirmed  
- Customer asks for investigator, legal, regulator, or cease contact  
- Hardship / dispute on amount / SAR-adjacent language  
- Merchant disputes accusation or demands named investigator  
- Confidence low / policy gap / would need PAN/CVV on call  
- attempt_n ≥ max_attempts without resolution  

**Warm transfer:** CALL-E transfers with case_id + reason_plain + last 3 turns in agent whisper; CRM assigns queue `fraud-ops-human`.

---


---

## Intent 4 — Evidence collection (investigations / safety)

**Use:** Fraud or safety investigation needs contemporaneous statements from **both parties** (complainant + respondent, or buyer + merchant). Agent places separate calls (or sequenced calls) with the same `case_id` / linked `counterpart_case_id`, asks what happened in their words, whether they can share evidence (screenshots, receipts, chat exports, photos), and SMS/emails a **time-boxed evidence share link** — never asks them to email raw files to a personal inbox.

**Call goal**
1. Light identity confirm (name + last-4 / order id) — no full ID numbers spoken  
2. Plain reason: “We’re collecting information for case `{case_id}` about `{incident_summary_plain}`” — no guilt assignment  
3. Open prompt: what happened, when, who else was involved  
4. Evidence ask: can you share screenshots / receipts / messages? → send `deep_links.evidence_share`  
5. Safety check: if they report ongoing danger, immediate harm, or request police — **stop script → `unsafe_escalate` / human handoff** (do not continue probing)

**Hard rails (extra)**
- Never coach either party on what to say; no leading questions that invent facts  
- Never share the other party’s statement, phone, or evidence with the counterpart  
- Never pressure (“you must upload or we close your account”) on safety cases — voluntary share + deadline in plain language  
- Do not collect passwords, 2FA codes, or full card numbers “as evidence”  
- If `safety_sensitive=true`: shorter script, earlier handoff triggers, no collections language  

**Return extras in `fields`:** `party`, `statement_summary`, `evidence_promised` (bool), `evidence_types[]`, `share_link_sent` (bool), `unsafe_flag` (bool)

**CRM/CMS:** each call writes an Activity on the case; both parties can land `will_upload`; investigators see a split view (Party A / Party B) — AI does not judge credibility.

**Automate when:** case status `needs_evidence` AND both parties have phones AND attempt caps allow.  
**Human when:** `unsafe_escalate`, either party asks for investigator, stories conflict and policy requires interview, or share-link abuse suspected.

**Mock case:** `case_demo_ev_001a` / `case_demo_ev_001b` — marketplace dispute (item not as described + safety concern flagged); share link `https://example.test/evidence/{case_id}?party=…`


---

## Care pillars (tone + rails for high-friction calls)

High-friction intents (collections, safety/evidence, sensitive follow-ups) balance **resolution** with **empathy**. Transactional scripts fail when the person is stressed, vulnerable, or defensive. De-escalation, psychological safety, and structured follow-through are required — not optional flavor text.

### Collections — collaborative recovery

| Do | Don't |
|---|---|
| Lead with empathy; acknowledge financial stress | Moralize, shame, or treat missed payment as character |
| Pivot from demand → options (PTP, plan, hardship path) | Demand full payment only / invent fees |
| Instant secure pay/plan link after agreement | Make them hunt for a portal or repeat card details on call |
| Absolute discretion; private channels only | Aggressive / public-facing pressure |

**Tone:** non-judgmental, pragmatic. **Goal:** collaborative problem-solving + long-term retention. Dignity rail already in hard rails (no PAN on call).

### Safety / evidence — containment & trust

When `safety_sensitive=true` or the caller reports ongoing harm:

| Do | Don't |
|---|---|
| Validate immediately; take ownership | Minimize, demand “proof,” or debate severity |
| Prioritize speed → `unsafe_escalate` / human advocate | Stay stuck in rigid KYC/collections script |
| One case owner; full context on warm transfer | Bounce across agents; force re-telling |
| Proactive status updates after the call | Go silent until they chase |

**Tone:** urgent, calm, authoritative. **Goal:** rapid containment + safety sentiment. Never share the other party’s statement.

### Sensitive follow-ups — close the loop

After any high-friction call, CRM write-back must schedule follow-through:

| Do | Don't |
|---|---|
| Proactive reach-out before SLA slip | Wait for the customer to chase |
| Continuity: next agent/call has full history | Make them re-explain distress |
| Brief root-cause / what we’re changing (when true) | Empty “we’re looking into it” forever |
| Low-friction resolution-sentiment check | Close ticket on internal metrics only |

**Tone:** accountable, transparent. **Metric:** re-contact rate + resolution satisfaction — not just disposition closed.

### Pillars table

| Dimension | Collections | Safety / evidence | Sensitive follow-ups |
|---|---|---|---|
| Primary goal | Collaborative problem-solving | Rapid containment & protection | Restore trust & prevent recurrence |
| Key tone | Non-judgmental, pragmatic | Urgent, calm, authoritative | Accountable, transparent |
| Critical metric | Retention + recovery | Time-to-containment + safety sentiment | Re-contact rate + resolution satisfaction |

### Script implications for CALL-E `task`

- Collections task text must open with acknowledgment + options, never threats.
- Evidence/safety task text must open with validation; any harm language → handoff.
- Outcome `next_action` should always set a follow-up SLA when disposition is open (`ptp`, `callback`, `will_upload`, `docs_promised`).
- Add outcome fields when wiring: `follow_up_at`, `sentiment_check_sent` (bool), `advocate_assigned` (bool on handoff).

## Hard rails (all intents)

- Never collect card PAN / CVV / full national ID spoken on the call — SMS/email deep link only  
- Never invent fees, balances, or legal threats  
- Never allege merchant guilt — case_id + high-level review only  
- HOLD / handoff if identity fails before sharing sensitive detail  
- Quiet hours + attempt caps enforced before dial  
- Log consent to continue recording where required  

---

## Out of scope (hackathon)

- Production TCPA/FDCPA legal opinion  
- Real bank core / live LMS write (mock JSON + webhook UI is enough)  
- Hosted propensity ML, skip-tracing, consortium scores  
- WhatsApp/document OCR pipeline (link only)  
- Multi-language beyond en (nice-to-have)  

---

## Build order

1. Schema + 3 mock cases + desk UI (queue → Call → outcome panel)  
2. CALL-E dial + KYC happy-path script  
3. Outcome webhook write-back  
4. Collections + merchant intents  
5. Evidence-collection intent (both-party mock + share link)  
6. Demo video (~3 min) + PR to `CALLE-AI/awesome-phone-call-agents` + feedback survey  

## Submit checklist (from CALL-E rules)

- [ ] PR into https://github.com/CALLE-AI/awesome-phone-call-agents  
- [ ] Public demo video ≤ ~3 min  
- [ ] CALL-E account email on form  
- [ ] Optional: live demo URL + feedback survey  

---

## Mock cases (seed)

1. `case_demo_kyc_001` — expired ID + missing PoA  
2. `case_demo_col_001` — HKD 2,400 / 18 DPD / pay link  
3. `case_demo_mer_001` — dispute spike / request bank statements  
4. `case_demo_ev_001a` / `case_demo_ev_001b` — both-party evidence collection (safety-aware) + share link  


### Hostility & foul language (Absorb → Separate → Pivot → Bound)

Never scold (“please refrain / watch your language”). Treat swearing as distress, not a power struggle.

1. **Absorb** — name the frustration without absorbing the insult  
2. **Separate** — validate the headache; worth ≠ delivery  
3. **Pivot** — blocked need (money, safety, control)  
4. **Bound** — binary low-friction choice (pause / specialist)

**Two-strike:** Strike 1 = de-escalation override + NVC reset. Strike 2 (continued hostility) = dignified handoff `hostility_two_strike` / senior specialist. Code: `detectHostility`, `handleHostilityTurn` in `src/lib/nvc.ts`.

