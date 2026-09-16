"""The natural-language CALL-E ``task`` for one speed-to-lead call."""
from __future__ import annotations

from typing import Any

DEFAULT_QUESTIONS = [
    "What is your budget range for this project?",
    "What is your timeline - when do you need this done?",
    "Are you the primary decision maker, or are others involved?",
]

# Contact fields are call inputs, not conversation context; they never go into the task text.
_NOT_CONTEXT = {
    "lead_id", "name", "full_name", "first_name", "last_name", "phone", "phone_number", "tel",
    "email", "email_address", "source_form", "consent_to_call",
}


def form_context(form: dict[str, Any]) -> str:
    lines = []
    for key, value in (form or {}).items():
        if key.startswith("_") or key in _NOT_CONTEXT or value in (None, "", [], {}):
            continue
        if isinstance(value, (dict, list)):
            continue
        lines.append(f"- {key.replace('_', ' ')}: {value}")
    return "\n".join(lines) or "- (no extra details were given on the form)"


def build_task(business: dict[str, Any], form: dict[str, Any]) -> str:
    company = business.get("name") or "our company"
    industry = (business.get("industry") or "home services").lower()
    agent = business.get("agent_name") or "Riley"
    first = (form.get("name") or "there").split()[0]
    questions = [q.strip() for q in business.get("qualification_questions") or DEFAULT_QUESTIONS if q.strip()]
    q_block = "\n".join(f"- {q}" for q in questions)

    return f"""Call {first} back about the quote request they just submitted on the {company} website.

WHO YOU ARE
You are {agent}, the virtual assistant for {company}, a {industry} company. Say you are the
company's virtual assistant in your first sentence. If asked whether you are an AI, say yes.

WHAT THEY TOLD US ON THE FORM
{form_context(form)}

OPENING
- "Hi, is this {first}? This is {agent}, the virtual assistant for {company}. You just asked for a
  quote on our website - do you have two minutes?"
- If it is not a good time, ask when to call back, thank them, and end the call.
- If it is the wrong person, apologize and end the call. If you reach voicemail, leave a
  one-sentence message saying {company} will follow up by text, and hang up.

QUALIFY, CONVERSATIONALLY - NOT AS A CHECKLIST
Weave these into the conversation in whatever order feels natural:
{q_block}
Follow up once when an answer is vague ("roughly what range are you thinking?").

CLOSE
- Offer to text a link to book a free consultation. Only say it will be sent if they agree.
- Thank them warmly by name.

RULES
- Keep the whole call under three minutes unless the lead wants to keep talking.
- Never quote prices, promise dates, or pressure the lead. If they are not interested, thank
  them and end the call.
- Do not ask for payment details, account numbers, or any sensitive personal information.
- Do not give legal, medical, financial, or safety advice."""
