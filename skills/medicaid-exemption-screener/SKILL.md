---
name: medicaid-exemption-screener
description: Run a consented outbound phone campaign that screens Medicaid enrollees for exemptions from the 2027 work requirement before their coverage check date - clearing whoever the state's own data already clears without a call, explaining the rule in the person's language, asking only the exemption questions their record has not answered, and turning every call into a caseworker-reviewed worklist item. Use for coverage-retention outreach, exemption screening, renewal-risk campaigns, and any benefits outreach where the point is to find people who qualify but will not file the paperwork.
license: MIT
---

# Medicaid Exemption Screener

Use this skill when someone needs to reach a list of benefits enrollees **before a deadline** and
find out which of them are already exempt or already compliant - not to remind them that paperwork
is due, but to ask the questions that decide it.

It wraps the `apps/typescript/still-covered` engine in this repository: ex parte clearing, wave
planning by deadline and paperwork risk, one CALL-E call task per person, fail-closed classification,
and a human worklist. An agent can drive a whole campaign without reimplementing any of it.

## The problem this solves

From 1 January 2027, most adults aged 19-64 on Medicaid must show 80 hours a month of qualifying
activity, or about $580 a month in earnings, to keep coverage (P.L. 119-21 section 71119; CMS
interim final rule CMS-2454-IFC). Nine categories are exempt.

The evidence is unambiguous about what goes wrong. Arkansas ran a work requirement in 2018: more
than 18,000 people lost coverage in seven months with **no significant change in employment**,
because the people who lost coverage were overwhelmingly already working or already exempt and
simply never completed the reporting (Sommers et al., *NEJM* 2019). In the 2023-24 unwinding, 69% of
disenrollments were procedural.

So the job is not "remind them." The job is **ask them**, in a language they speak, and put a
reviewable packet in front of a caseworker for everyone whose answers suggest they qualify.

## When To Use

- A state agency, health plan, or community organisation has a **consented** enrollee list with
  coverage check dates approaching, and wants to know who is exempt or compliant before the deadline.
- The user asks to "screen," "check who qualifies," "find who is exempt," or "reach people before
  they lose coverage."
- A prior campaign was interrupted and must be resumed without double-dialling anyone.
- The user wants to rehearse the calls, hear the script, or show a stakeholder what the calls sound
  like without spending credits - run the dry-run path, which needs no key and places no call.

## When Not To Use

- **Do not** cold-call people who have not consented to be contacted about their coverage. This
  engine assumes a consented enrollee list and refuses rows whose `consent` column is not `yes`.
- **Do not** use it to make or communicate a benefits determination. The agent is explicitly
  forbidden from telling anyone they are exempt; every verdict is a proposal awaiting a human.
- **Do not** use it for marketing, enrolment sales, plan switching, or lead generation.
- **Do not** run a live campaign without the user's explicit confirmation that the list is real,
  authorized, and consented, and without an allowlist during rehearsal.
- **Do not** invent rules. If the user's state has its own exemption list, edit the rules file - do
  not let the agent improvise policy on the call.

## Core Workflow

1. **Confirm consent and authorization.** The user should say plainly that this is their own
   enrollee list and that these people agreed to be contacted about their coverage. If they cannot,
   stop.
2. **Load the list and let the data clear whoever it can.** Run `plan` first, always. It places no
   call, prints who the state's own record already clears, shows the wave order, and prints the exact
   task text that would be spoken. See `references/registry-format.md` for the CSV columns and
   `references/cli.md` for the commands.
3. **Review the rule file.** `rules/federal-2027.json` holds the threshold, the plain-language
   explanation, and all nine exemptions with their question text and order. If the user's state
   differs, edit the JSON. See `references/rules-and-questions.md`.
4. **Rehearse in dry-run.** `run` against the bundled fake CALL-E server exercises webhooks, retries,
   idempotency and the full worklist with no network and no credentials.
5. **Go live only on explicit confirmation.** Live mode requires `SC_MODE=live`, a `CALLE_API_KEY`,
   and `--confirm`. Set `SC_LIVE_ALLOWLIST` for any rehearsal so a real enrollee cannot be reached
   by accident. Read `references/safety.md` before this step, every time.
6. **Hand over the worklist, not a verdict.** Report outcomes as proposals: how many were cleared
   without a call, how many look exempt and need a caseworker's review, how many are at risk, how
   many could not be reached and need a letter. Never tell the user that someone "is exempt."
7. **Resume rather than re-run.** If a campaign was interrupted, `resume` settles pending calls and
   re-places refused tasks with their original idempotency keys. Re-running `run` is not the way to
   recover, and `resume` on a finished campaign places no new call at all.

## The Rules That Are Not Negotiable

These are enforced in code, not just in the prompt. Do not try to work around them.

- **Ex parte first.** Anyone the state's data already clears is never called.
- **Fail closed.** Silence, ambiguity, a cut-off call, or a health condition without a daily-activity
  limitation produces `needs_review` - never an exemption.
- **Identity before disclosure.** Nothing about Medicaid or coverage is said until the person
  confirms their birth year, and the agent never says the year first.
- **The voicemail must not mention Medicaid.** Validated when the state file loads.
- **Three calls, maximum, per person, per campaign.** A hard cap independent of configuration.
- **A refused API request is `not_attempted`, never `unreachable`.** Our failure never becomes the
  person's verdict.
- **Live campaigns start from the CLI only.** The dashboard returns 403.

See `references/safety.md` for the complete boundary list, including what the agent may never ask for.

## Worked Examples

`references/examples.md` walks through: a clean dry-run campaign and how to read its output; a
Spanish-language call end to end; the person whose condition does not limit daily activities and why
that becomes `needs_review`; the agent overclaiming an exemption and the correction call that
follows; a platform outage; and a resumed campaign.

## Reporting Results

Summarize in this shape, and in this order:

- cleared by state data, no call needed
- may qualify for an exemption - packet waiting on a caseworker
- may already meet the requirement - needs to report hours
- at risk - navigator callback booked
- needs review / could not be reached - letter and community outreach
- **how many had never heard of the rule before the call**

That last number is usually the one a programme director cares about most, and it is the one only a
conversation can produce.
