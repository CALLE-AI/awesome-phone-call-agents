# Rules and questions

The policy lives in JSON, not in code. Two files decide everything the agent says:

- `rules/federal-2027.json` - what the law requires and who is exempt.
- `states/example-state.json` - who is calling, how to report, and what the voicemail says.

Both are validated when they load. A rules file that would make the agent behave unsafely fails the
load rather than the call.

## The requirement

```json
{
  "hours_per_month": 80,
  "income_per_month_usd": 580,
  "plain_language": "Starting in January 2027, most adults aged 19 to 64 on Medicaid need to show 80 hours a month of work, school, volunteering, or a job training program, or earn about 580 dollars a month, to keep their coverage. Some people are exempt.",
  "awareness_question": "Before this call, had you heard about the new Medicaid rule about work hours that starts in January?",
  "hours_question": "In a typical month, about how many hours do you work, go to school, volunteer, or take part in a job training program? A rough number is fine.",
  "income_question": "Do you earn more or less than about 580 dollars a month before taxes?"
}
```

Source: P.L. 119-21 section 71119 and the CMS interim final rule CMS-2454-IFC (June 2026), as
summarized by KFF, State Health and Value Strategies, and CHCS. Age range 19-64.

**The awareness question is asked first, before the explanation.** It is the only way to measure how
many people have no idea the rule exists - and in the sample campaign it is 5 of the 8 people who
answered. A programme director who learns that 63% of their at-risk enrollees have never heard of
the rule has learned something no portal analytics can tell them. Ask it before you explain, or the
answer means nothing.

## The nine exemptions

Asked in this order, and the agent **stops at the first yes**:

| # | Code | Question |
| --- | --- | --- |
| 1 | `caregiver_child` | Do you take care of a child who is 13 or younger? |
| 2 | `pregnant_postpartum` | Are you pregnant right now, or have you had a baby in the last year? |
| 3 | `caregiver_disabled` | Do you take care of someone with a disability, like a parent or another family member? |
| 4 | `medically_frail` | Do you have a health condition, a disability, or a mental health or substance use condition? |
| 5 | `snap_tanf` | Do you get SNAP food benefits or TANF cash assistance? |
| 6 | `veteran_disability` | Are you a veteran with a total disability rating from the VA? |
| 7 | `sud_treatment` | Are you in a drug or alcohol treatment program right now? |
| 8 | `former_foster_youth` | Were you in foster care when you turned 18? *(only asked if under 26)* |
| 9 | `tribal` | **never asked** |

Three things about that table are deliberate and are enforced, not merely intended:

**Order is by prevalence, not by statute order.** Caregiving and pregnancy clear the most people, so
they go first, so most calls are short. A person who qualifies on question one never hears questions
two through eight.

**`tribal` has `question: null`.** `validateRules` fails the load if a question is ever added to it.
Tribal status is established administratively. Asking someone to declare their ancestry to a robot to
keep their health coverage is not an acceptable interaction, and making that a load-time failure
means no future edit can reintroduce it by accident.

**`former_foster_youth` carries `ask_if_age_under: 26`.** Asking a 58-year-old whether they were in
foster care at 18 is a pointless intrusion, so the age gate is in the rule data.

## Medical frailty needs two answers

```json
{
  "code": "medically_frail",
  "question": "Do you have a health condition, a disability, or a mental health or substance use condition?",
  "follow_up": "Does it make it hard for you to work or to do everyday things, like getting dressed, shopping, or getting around?"
}
```

`validateRules` **requires** the follow-up to exist. The CMS rule defines medical frailty as a
qualifying condition **and** a functional limitation, and the classifier enforces both: a condition
with no reported limitation produces `needs_review` and a navigator callback, never an exemption.

The agent is instructed never to ask for a diagnosis, and to tell anyone who starts describing one
that they do not need to share details.

## What the agent is allowed to say at the end

Exactly three closings, and nothing stronger:

1. **"you may qualify for an exemption. The state makes the final decision, and a caseworker will review it."**
2. **"It sounds like you may already meet the requirement. You will still need to report it."**
3. **"It sounds like you may need some help meeting or reporting the requirement. A free navigator can help."**

Followed by how to report, and the self-attestation note: in 2027 the state accepts the person's own
word for most exemptions and may ask for documents later. That sentence prevents the most common
harmful reaction to this kind of call - assuming you need paperwork you do not have, and giving up.

The task says, in those words: **"Never say they are exempt."** If the structured result shows the
agent said more than the answers support, the classifier flags it and a human calls back to correct
it. See `references/safety.md`.

## The state file

```json
{
  "caller_org": "Example State Health Plan",
  "report_how": "online at benefits.example.org, by calling 1-800-555-0100, or with help from a free navigator",
  "callback_phone": "1-800-555-0100",
  "navigator_line": "1-800-555-0101",
  "voicemail": "Hello, this is Example State Health Plan with an important message about your health coverage. Please call us back at 1-800-555-0100. Thank you.",
  "self_attestation_note": "In 2027 the state accepts your own word for most exemptions, and it may ask for documents later."
}
```

`validateState` **rejects a voicemail that mentions Medicaid.** Answering machines are shared with
housemates, family, and employers; a voicemail is not a private channel, so it says "health
coverage" and gives a number to call back.

`navigator_line` is a real human. Every closing offers it, and anyone who asks for a person gets it.

## Adapting to a state

Copy `states/example-state.json`, edit it, and run with `--state <id>` or `SC_STATE=<id>`. If the
state's exemption list differs from the federal baseline, copy `rules/federal-2027.json`, edit the
`exemptions` array, and pass `--rules`.

Two states ship, and the second exists to prove this is real rather than claimed:

```bash
npm run sc -- plan --state second-state
```

`second-state` is a state that did **not** adopt self-attestation. Its caller organisation, callback
number, navigator line, voicemail, reporting channels and closing advice are all different, and the
entire call re-renders from that one JSON file with no code change. A test asserts that every state
file on disk validates, that the two produce different call text, that each state's own wording
reaches its own call and does not leak into the other's — and that the federal *policy questions* are
worded identically in both, because those come from the rules file, not the state file.

Run `plan` afterwards and read the rendered task aloud. That is the review step: the task text is
generated from these two files and nothing else, so if it sounds wrong, the fix is in the JSON.

## Sources

- P.L. 119-21 section 71119; CMS interim final rule CMS-2454-IFC (June 2026).
- Sommers BD et al., "Medicaid Work Requirements - Results from the First Year in Arkansas,"
  *N Engl J Med* 2019;381:1073-1082.
- KFF, Medicaid Enrollment and Unwinding Tracker (69% of disenrollments procedural).
- Congressional Budget Office, coverage estimates for P.L. 119-21.

States may add details. Check the state's own rules before any live use. This is not legal advice.
