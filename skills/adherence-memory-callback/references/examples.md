# Worked Examples

All phone numbers below are fictional samples. Transcripts are illustrative.

## Example 1 — a candidate fact is learned (one caller)

Caller `+12025550101` (Asha), on Metformin:

> "I've been taking it every day, but honestly it makes me feel sick to my
> stomach most mornings."

The agent maps "sick to my stomach" to the canonical symptom `nausea` and writes:

- **Sub-brain (Asha):** "Taking Metformin daily, reports morning nausea."
  Open item: "check if nausea settled."
- **Master brain:** candidate fact `Metformin may cause nausea in some patients`
  (1 distinct source — not yet trusted).
- **Signal:** `drug:Metformin|symptom:nausea` count 1.

Nothing is proactively asked of future callers yet.

## Example 2 — corroboration promotes it (a second, distinct caller)

Caller `+12025550102` (Ravi), on Metformin:

> "Doing okay with the tablets. A little nausea now and then. And I'm about to
> run out — need a refill."

Ravi is a **distinct** source reporting the same symptom, so:

- The candidate fact becomes **canonical**: `Metformin may cause nausea in some
  patients` (2 distinct sources).
- The signal reaches the staff-alert threshold and is **raised to staff**.
- Ravi's sub-brain notes nausea and an open item "arrange refill."

If Ravi had simply called back and repeated himself, it would **not** promote —
corroboration requires distinct sources.

## Example 3 — human-in-the-loop before proactive questions

The corroborated nausea pattern is surfaced to an **admin** as a proposed prompt
change:

> Ask new callers: "Have you noticed any nausea?" — and if not, remind them to
> contact the pharmacy if they ever do.

- If the admin **Confirms** (or enough distinct callers auto-apply it), the next
  call's goal gains that proactive question.
- If the admin **Dismisses** it, the agent does not ask, even if more callers
  report it, until it is explicitly re-approved.

A new caller then hears, gently and only once:

> "Have you noticed any nausea? … No? Okay — if you ever do, please contact the
> pharmacy right away."

## Example 4 — "call me back" continuity

Caller `+12025550103` (Meena):

> "Sorry, I'm at a wedding right now — can you call me back later?"

The agent stores the callback reason. On the **next** call it opens with it:

> "Hi Meena — last time you were at a wedding, how did it go? … Great. Just a
> quick medication check-in…"

Once Meena engages, the callback context is cleared so it is not repeated.
