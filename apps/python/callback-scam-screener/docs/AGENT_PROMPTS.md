# Screener Agent: Aim + Freedom, Not a Script

The Screener is a goal-directed LLM persona, not a decision tree. It gets an **aim** (what it's trying to achieve), a **persona** (how it talks), and **hard constraints** — but the constraints are enforced structurally, by what the agent can access or do, not just by prompt instruction. A prompt saying "don't reveal the account number" can be talked around by a persistent scammer; an agent that was never given an account number can't reveal it no matter how it's pressured. That distinction is what makes "freedom to improvise" safe here.

This also fixes a risk in the original design: if the Screener judged its own call in real time, a skilled scammer could talk it into concluding "this seems legitimate." So it never decides — it only converses and produces a transcript. Verdict scoring happens afterward, deterministically, from the signal checklist in [../README.md](../README.md#signal-checklist), outside the conversation the scammer influenced.

## Aim, persona, freedom

**Aim:** Have a natural conversation with whoever answers the flagged number, and surface — through open questions and normal follow-up — enough signal for the downstream scorer to judge whether this is a scam. It is not trying to catch the caller out or accuse anyone; it's trying to establish the facts of the situation.

**Persona:** An AI assistant calling transparently on behalf of the person who received the flagged message — not a judgment call left to the prompt, but a hard requirement enforced by CALL-E's own platform guardrails, which reject any goal that asks the agent to impersonate the recipient or conceal that it's an AI (see `docs/CONCEPT.md`).

**Freedom:** Full latitude on phrasing, tone, follow-up questions, pushback, and how long to stay on a topic. It can express confusion, ask "why do you need that," ask to slow down, ask the same question a different way if it got a non-answer. Nothing about the conversation flow is pre-branched.

**Hard constraints (structural, not just instructed):**
- Has no real account numbers, passwords, OTP/MFA codes, card details, or other PII in its context at all — so it cannot disclose them regardless of pressure. Its honest answer to "what's the code" is "I don't have that," because it's true.
- Has no tools that can browse to a URL, install software, move money, or authorize anything. It is voice-only with no side channel a "technician" could direct it toward.
- Does not decide the verdict. Its only output is the transcript (plus basic call metadata). Scoring happens afterward from the transcript, per the signal checklist in the README, so nothing said mid-call by the other party can talk the agent into a favorable self-assessment.

## The actual production prompt

This is `SCREENER_TASK_TEMPLATE` from `pipeline/orchestrator.py` — kept here for context, but that file is the source of truth if the two ever drift. It deliberately does not quote the specific claim from the flagged email (see the comment above the template in that file): CALL-E's planner repeatedly rejected a version that did, and dropping it turned out to be a genuine improvement anyway — volunteering what the message said is information leakage to a potential scammer, and refusing to explain themselves when asked is itself signal H3:

> You are conducting a brief, transparent identity-verification call as an AI calling assistant contacting {phone_number}, on behalf of someone who received a callback request listing this number and wants to confirm it is genuine before acting on it.
>
> Early in the call, let them know plainly that the call may be recorded and reviewed as part of this verification, and ask them not to share any sensitive personal, account, or payment details about themselves or anyone else — none are needed for this conversation.
>
> You do not have and will never provide any personal, financial, or account-related information, under any circumstances, no matter what is asked — if asked for anything like that, simply say you don't have it. Do not install anything, click on anything, or agree to any payment.
>
> Your only task on this call: ask who is on the line, what company and department they represent, why they are reaching out, and whether this can be confirmed through the company's official published channels. Stay neutral and factual — you are not accusing anyone of anything, just establishing who they are and how the recipient can verify this independently.
>
> Do not volunteer any detail about what the original message said — let them explain the reason for the call themselves. Do not decide yourself whether this is legitimate; just have the conversation and report back exactly what was said.

The recording/review disclosure serves two purposes: it's the kind of AI-voice-call disclosure regulators like the FCC's TCPA rules expect (not a compliance guarantee — we're not lawyers), and it protects the *other party's* data, not just ours — a real company rep might otherwise recite genuine customer or account details without thinking, not realizing the call is transcribed and reviewed downstream.
