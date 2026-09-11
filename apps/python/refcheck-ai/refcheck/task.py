"""The natural-language instruction CALL-E carries out on the call."""
from __future__ import annotations

def build_reference_task(
    reference: dict,
    candidate: dict,
    questions: list[dict],
) -> str:
    """Natural-language instruction for one reference call."""

    def render(q: dict, idx: int) -> str:
        text = (
            q["text"]
            .replace("{candidate_name}", candidate["name"])
            .replace("{role}", candidate["role_applied_for"])
            .replace(
                "{jd_summary}",
                candidate.get("job_description_summary") or "a range of responsibilities",
            )
        )
        line = f"{idx + 1}. {text}"
        if q.get("follow_up"):
            line += f'\n   If the answer is short or vague, probe once: "{q["follow_up"]}"'
        return line

    question_block = "\n".join(render(q, i) for i, q in enumerate(questions))
    company = candidate["company_name"]
    referee = reference["referee_name"]
    who = candidate["name"]

    return f"""Conduct a professional employment reference check by phone.

You are calling {referee}, who {who} listed as a professional reference. You are
calling on behalf of the recruiting team at {company}, which is considering {who}
for a {candidate["role_applied_for"]} role.

OPENING
- Introduce yourself: "Hello, this is Alex calling from the {company} recruiting team."
- Confirm you are speaking with {referee}.
- State why you are calling: {who} listed them as a reference and has given
  {company} permission to make contact.
- Ask whether now is a good time and that you need about ten minutes. If it is
  not, ask when to call back, thank them, and end the call.

IF THEY WILL ONLY CONFIRM DATES OF EMPLOYMENT
Many companies have a policy against giving substantive references. If that comes up:
- Accept it immediately: "I completely understand, and I appreciate your transparency."
- Ask one open question: "Is there anything at all you'd like us to know about
  {who} as a professional?"
- Whatever they answer, thank them and close. Do not push, rephrase, or try again.

QUESTIONS
Work through these conversationally — not as a checklist. Follow the thread of
what they say, and ask them in whatever order the conversation makes natural.
{question_block}

HOW TO CONDUCT THE CALL
- Probe once when an answer is short, vague, or purely positive with no example:
  "That's helpful — can you give me a specific example?"
- Pay attention to hesitation, long pauses, and qualifiers such as "I think",
  "generally", or "mostly". They are meaningful signal and belong in your notes.
- Never lead the referee toward a favourable answer and never characterise
  what other referees have said.
- If they raise a concern, let them finish and ask one neutral follow-up. Do not
  argue or defend the candidate.
- Do not discuss compensation, health, age, family status, or any other
  protected characteristic. If the referee raises one, do not pursue it.
- Keep the whole call under 15 minutes.
- Close with: "Thank you so much for your time — this is genuinely useful to us."

The reference is complete once you have either worked through the questions or
established that the referee will not answer them."""
