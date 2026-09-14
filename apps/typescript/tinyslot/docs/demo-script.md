# TinySlot Three-Minute Demo Script

Use the public, synthetic demo for predictable recording:

<https://utpal-kalita.github.io/tinyslot-demo/>

Target runtime: **2:50-3:05**. Speak naturally at approximately 140-150 words per minute. Pause briefly after important results so judges can read the screen.

## Before Recording

- Set browser zoom to 90-100% and use a 16:9 window.
- Select **Demo** mode and reset the scenario.
- Close unrelated tabs and disable notifications.
- Do not show `.env.local`, credentials, real phone numbers, or a private transcript.
- Keep this script on a second device or window that will not be recorded.

## 0:00-0:20 - Hook and Problem

**Show:** Landing hero and the illustrated call pipeline. Do not move the cursor for the first two seconds.

**Narrate:**

> Finding childcare looks like a search problem, but it ends as phone work. Directories show which centers exist, not whether a toddler room has an opening for the exact days and hours a parent needs. TinySlot calls approved centers and turns current answers into comparable evidence.

**Judge takeaway:** This is a specific, real phone-work problem rather than a generic voice agent.

## 0:20-0:43 - Explain the Architecture

**Action:** Scroll through the trust strip and stop on **How TinySlot works**.

**Narrate:**

> The workflow has three parts. The parent defines what must fit. CALL-E handles the natural conversations and returns a strict result for every center. TinySlot then applies deterministic checks and stops when the search has enough qualified options.

**Judge takeaway:** CALL-E conducts conversations; application code controls recipients, evidence, decisions, and stopping.

## 0:43-1:05 - Build the Privacy-Minimized Brief

**Action:** Scroll to **What must the opening fit?** Point to the age band, date, weekdays, hours, budget, and match target.

**Narrate:**

> This search needs toddler care by October fifteenth, on Monday, Wednesday, and Friday, from eight thirty to five thirty. TinySlot needs practical constraints, not the child's name, diagnosis, documents, or home address. The budget stays local and is never disclosed during calls.

**Judge takeaway:** Data minimization is part of the product, not an afterthought.

## 1:05-1:35 - Run the Adaptive CALL-E Wave

**Action:** Show the six-center list. Point out that three are in Wave 1 and three are held back. Click **Run simulated search**. Wait for completion and show the stop rule.

**Narrate:**

> TinySlot starts with three approved centers. CALL-E asks the same core questions and returns schema-validated outcomes. Willow Room and Alder House report matching openings; Moss and Moon reports a waitlist. These outcomes stay separate. Because the two-match target is reached, three later calls are avoided.

**Judge takeaway:** The agent minimizes cost and interruption instead of blindly dialing the entire list.

## 1:35-2:10 - Inspect Matches and Evidence

**Action:** Click **Compare evidence**. Show the metrics, qualified results, and waitlist result. Expand **Call summary** on Willow Room.

**Narrate:**

> An AI summary does not decide the match. Deterministic code checks the business, age band, vacancy, start date, weekdays, hours, subsidy, budget, and evidence. Missing hard evidence routes to review instead of becoming a convenient guess. Every center keeps its own summary, structured outcome, checks, transcript turns, and quotations.

**Action:** Briefly show the report controls.

> Results can be exported as JSON or a privacy-masked conversation PDF. Phone-like values are removed before rendering.

**Judge takeaway:** Results are inspectable, attributable, portable, and fail closed.

## 2:10-2:27 - Show Real CALL-E Validation

**Show:** Run the read-only proof command in a clean terminal and display its sanitized result for 10-15 seconds. Do not show `.env.local`, the actual number, or transcript text.

```bash
cd apps/typescript/tinyslot
npm run proof:live -- --call-id call_YjAE3eI6e4yLBj_NecUmuQ
```

Display:

```text
Authorized live CALL-E validation
Status: completed
Task completed: true
Confidence: high (0.86)
Structured result: schema-valid
TinySlot checks: 8 passed
```

**Narrate:**

> The public demo is synthetic for safety. The same workflow completed an authorized live CALL-E call with task completed true, high confidence of point eight six, a schema-valid result, and all eight checks passing.

**Judge takeaway:** CALL-E is imported and called at runtime; the safe public demo is not the only implementation.

## 2:27-2:48 - Approve a Tour

**Action:** Select **Review tour request** for Willow Room. Show the disclosure envelope. Type `REQUEST TOUR`, then click **Approve and request**.

**Narrate:**

> Finding an opening does not authorize another call. The parent reviews what TinySlot may share and approves one tour request. CALL-E can use only the approved contact and scheduling details. It cannot enroll, accept policies, make payments, or reveal the child's identity.

**Judge takeaway:** Authority is explicit, narrow, and tied to one real-world side effect.

## 2:48-3:00 - Outcome and Close

**Show:** Confirmed synthetic tour outcome. Hold on the final screen for one second after speaking.

**Narrate:**

> TinySlot turns stale listings into an auditable childcare search: fewer calls, current evidence, human authority, and a real next step. CALL-E handles the conversation while people control who gets called, what counts as evidence, and what happens next.

## Recording Checklist

- The final video is approximately three minutes.
- The product name and problem are clear in the first 20 seconds.
- CALL-E's runtime role is explicitly explained.
- The adaptive stop rule and calls avoided are visible.
- At least one deterministic match check is readable.
- The call summary and conversation PDF option are shown.
- The sanitized live-validation facts are visible.
- The exact tour-approval boundary is demonstrated.
- No credential, real number, private transcript, or account email appears.
- The video is uploaded publicly to YouTube or Vimeo.
