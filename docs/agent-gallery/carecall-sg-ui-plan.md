# CareCall SG — UI and Product Implementation Plan

This document is the implementation source of truth for restructuring Agent Gallery into **CareCall SG**, a Singapore-focused Care Companion Calling Agent for seniors.

## Working Definition

In this document, **CCA** means **Care Companion Calling Agent**.

CareCall SG uses CALL-E to make caregiver-authorized reminder and check-in calls. It helps seniors maintain everyday medication and meal routines, records only self-reported outcomes, and routes exceptions to a human caregiver or care coordinator.

The application is a reminder, check-in, and escalation system. It is not a medical adviser, emergency service, adherence-monitoring device, or replacement for human care.

## Product Promise

> CareCall SG reminds seniors about caregiver-approved medication and meal routines, checks their self-reported status, and alerts a human when something needs attention.

The stronger hackathon story is:

> CareCall SG helps seniors living independently maintain their daily care routines while giving caregivers an exception-only safety net—without offering medical advice, demanding an app, or replacing human care.

## Problem

Seniors living independently may need simple, familiar reminders for daily medication and meals. Family members and community-care staff often repeat these calls manually, yet a successful call does not necessarily prove that medication was taken or a meal was eaten.

The application must solve four operational problems:

1. Deliver a scheduled reminder through an ordinary phone call.
2. Ask a small number of clear follow-up questions.
3. distinguish a self-reported routine completion from uncertainty or lack of access.
4. Notify a human only when human attention is useful.

## Primary Users

### Senior Receiving the Call

The senior's interface is the phone call. They should not need to install or learn an application.

The call experience must provide:

- The senior's preferred name and form of address.
- A verified preferred language.
- One question at a time.
- Short sentences and an unhurried pace.
- A way to ask for repetition.
- A way to request a caregiver callback.
- No request for money, OTPs, banking details, passwords, or full NRIC.
- A clear and polite ending.

### Family Caregiver

A family caregiver may:

- Enrol a senior with an appropriate consent or authority record.
- Configure permitted reminder schedules.
- Review exceptions.
- Pause or stop schedules.
- Receive a daily exception-focused digest.

### Care Coordinator

An operator at an Active Ageing Centre or community-care organisation may:

- Review reminders across multiple seniors.
- Monitor live call delivery.
- Triage cases needing human attention.
- Record follow-up actions.
- Audit consent, schedule, and call history.

## Product Boundaries

### CareCall SG May

- Repeat a caregiver-approved medication reminder.
- Ask whether the senior reports already taking the scheduled medication.
- Ask whether the senior is unsure or needs human help.
- Ask whether the senior reports eating a scheduled meal.
- Ask whether food is available.
- Ask whether a planned meal delivery arrived.
- Offer to request a caregiver callback.
- Record a self-reported result.
- Escalate an exception according to a pre-authorized care-circle policy.

### CareCall SG Must Never

- Diagnose a condition.
- Recommend a dosage.
- Tell a senior to repeat, skip, delay, or change medication.
- State that a medicine is safe to take.
- Infer that medicine should be taken with food.
- Change a prescribed or caregiver-entered schedule.
- Treat silence, hesitation, or ambiguity as completion.
- Claim that a caregiver is coming unless this is confirmed.
- Order food or services without prior authority.
- Ask for payment, bank information, OTPs, passwords, or full NRIC.
- Call additional contacts outside the authorized escalation policy.
- Create hidden recurring schedules.
- Automatically contact emergency services.

HealthHub recommends medication-reminder routines but states that missed-dose actions depend on the specific medication and should be checked through medication-specific information or with a doctor or pharmacist. CareCall must therefore route uncertainty to a human rather than provide an instruction.

Reference: [HealthHub medication reminder guidance](https://www.healthhub.sg/medication-devices-and-treatment/handling-medications/remember-to-take-meds).

## Singapore Context

- Default timezone: `Asia/Singapore`, disclosed to the operator.
- Use Singapore date and time formatting, for example `4 Aug 2026, 12:30 PM`.
- Store language preference explicitly. Never infer language from ethnicity, name, or phone number.
- The MVP operator interface remains in English.
- Add Mandarin, Malay, and Tamil calling only after CALL-E quality is verified for each language.
- Never infer a dialect preference.
- Use the senior's selected form of address, such as Mr, Mdm, Ms, Encik, Cik, or a custom preference.
- Do not automatically call seniors “Uncle” or “Auntie.”
- Configure quiet hours per senior and organisation.
- Allow public-holiday and temporary schedule exceptions.
- Keep phone numbers masked outside a necessary input or authorized detail view.
- Treat medication routines, meal routines, phone numbers, transcripts, and care-circle details as sensitive personal data.
- Make consent, notification, purpose, access, retention, and deletion behavior explicit.

Singapore privacy reference: [Personal Data Protection Act](https://www.pdpc.gov.sg/organisations/regulations-decisions/personal-data-protection-act-pdpa).

### Emergency Boundary

SCDF identifies **995** for fire, rescue, and emergency ambulance services. CareCall is not an emergency service and must not be the only route for urgent help.

When a conversation indicates immediate danger, the agent may state that the senior or another person should contact 995 and should trigger the pre-authorized human escalation path. It must not diagnose the condition or claim that an ambulance has been dispatched.

Do not build the 1777 non-emergency ambulance number into durable product logic because SCDF states that the hotline will cease on 1 January 2027.

Reference: [Singapore Civil Defence Force](https://www.scdf.gov.sg/).

### Food-Access Boundary

Meal reminders must check access rather than merely repeat “remember to eat.” Useful exceptions include:

- No food available.
- Unable to prepare food.
- Planned meal delivery did not arrive.
- Senior feels unwell.
- Senior requests human help.

Singapore context reference: [AIC Meals on Wheels](https://aic.sg/Care-Services/Meals-on-Wheels).

## Information Architecture

Primary navigation:

1. **Today**
2. **Seniors**
3. **Care Routines**
4. **Needs Attention**
5. **Settings**

`Needs Attention` displays a badge only when an actionable case exists. Avoid covering the dashboard in red counts or health-style risk scores.

## End-to-End Flow

```text
Today
  -> Senior profile
  -> Care routine
  -> Dry-run preview
  -> Authorize one call or activate schedule
  -> CALL-E call
  -> Self-reported outcome
  -> Routine complete or Needs Attention
  -> Human follow-up
```

## Screen Specifications

### 1. Today

This replaces the current marketing-style landing page.

#### Header

Example:

```text
Good afternoon
Tuesday, 4 August · Singapore
```

The header also contains:

- Current organisation or care team.
- Operator identity and role.
- Search.
- Notification or Needs Attention shortcut.
- CALL-E service state when degraded.

#### Operational Summary

- Reminders today.
- Self-reported complete.
- Upcoming.
- Needs attention.

Do not present completion percentages as clinical adherence scores.

#### Care Timeline

| Time | Senior | Reminder | Status |
| --- | --- | --- | --- |
| 8:00 AM | Mdm Lim | Morning medication | Self-reported taken |
| 12:30 PM | Mr Rahman | Lunch check-in | Due now |
| 1:00 PM | Mdm Devi | Medication reminder | Needs caregiver |
| 6:30 PM | Mr Tan | Dinner check-in | Upcoming |

Permitted status labels:

- `Due`
- `Calling`
- `Self-reported taken`
- `Self-reported ate`
- `Will do shortly`
- `Needs caregiver`
- `No answer`
- `Call failed`
- `Paused`
- `Uncertain`

Never display `Medication taken` as verified fact.

#### Empty States

- No reminders today: show the next scheduled reminder and a link to care routines.
- No seniors enrolled: explain enrolment and provide one primary action.
- CALL-E unavailable: preserve schedule visibility, disable calls with a reason, and provide a retry path.

### 2. Seniors

Use a master-detail view on wide screens and push navigation on narrow screens.

#### List

Each list row shows:

- Preferred display name.
- Next scheduled reminder.
- Last successful contact.
- Current operational state.
- Needs Attention indicator when applicable.

Do not show diagnoses or medication names in the list.

#### Senior Profile

Profile header:

```text
Mdm Lim Siew Lan
Prefers “Mdm Lim” · English
Calls permitted 8:00 AM–8:00 PM
Primary caregiver Joanne Lim
```

Profile sections:

- Today
- Care routine
- Care circle
- Call history
- Consent and privacy

The profile shows:

- Preferred name and form of address.
- Masked phone number.
- Explicit language preference.
- `Asia/Singapore` timezone.
- Quiet hours.
- Primary caregiver.
- Consent status and review date.
- Last completed contact.
- Next scheduled reminder.

### 3. Care Routine Builder

Routine types:

- Medication reminder.
- Breakfast check-in.
- Lunch check-in.
- Dinner check-in.
- Hydration check-in.
- General wellbeing call.

#### Medication Routine

Fields:

- Caregiver-approved label, such as `morning medication`.
- Scheduled time.
- Start date.
- End or review date.
- Preferred spoken wording.
- Language.
- No-answer behavior.
- Human escalation contact.
- Quiet-hour conflict state.
- Pause and delete controls.

Do not require a clinical medication name unless an authorized care provider needs it. Do not ask the operator to enter dosage advice into the call script.

#### Meal Routine

Fields:

- Meal type.
- Expected time.
- Start date.
- End or review date.
- Whether a delivery is expected.
- Meal-service display name where applicable.
- Missing-delivery escalation contact.
- No-answer behavior.
- Quiet-hour conflict state.

#### Schedule Lifecycle

Every recurring routine exposes:

- Consent date.
- Creation date.
- Created by.
- Next scheduled call.
- Last call.
- Review date.
- Pause.
- Resume.
- Edit without duplication.
- Delete.

Architecture:

```text
Host scheduler handles recurrence.
CALL-E performs exactly one call per scheduled run.
```

### 4. Dry-Run Preview

The preview must be the default path and perform no call.

Example summary:

```text
Call Mdm Lim at +65 ••••• 123
Today at 12:30 PM
Language: English
Purpose: Lunch check-in
```

#### The Agent Will

- Identify CareCall SG and the sponsoring care organisation.
- Use the senior's preferred form of address.
- State the scheduled reminder purpose.
- Ask one question at a time.
- Offer to request a caregiver callback.
- End politely.

#### The Agent Will Never

- Ask for payment, banking details, an OTP, password, or full NRIC.
- Diagnose a condition.
- Recommend or change a medication dose.
- Tell the senior to repeat or skip medication.
- Change a care schedule.
- Claim that help is coming unless confirmed.

Actions:

- Back.
- Save as draft.
- Authorize one call.
- Activate schedule.

Activating recurrence requires a stronger, distinct confirmation that shows the next call, frequency, review date, and cancellation method.

### 5. Authorization

For one call:

> I authorize one CareCall SG call to Mdm Lim now for the lunch check-in shown above.

For a recurring routine:

> I confirm that this senior is enrolled for this reminder schedule, understand when calls will occur, and know how to pause or cancel it.

The server must verify authorization and access; a client-side checkbox alone is not a security boundary.

### 6. Live Call

The live-call screen remains calm and operational.

Show:

- Preferred senior name.
- Masked phone number.
- Reminder purpose.
- Elapsed time.
- Current delivery state.
- Settled activity milestones.

Example milestones:

- Preparing call.
- Phone ringing.
- Call connected.
- Conversation in progress.
- Call completed.

Do not display unstable partial speech recognition by default. An authorized coordinator may open the final transcript after completion if policy and role permit it.

Error states must state whether a call may still be running. Never encourage blind retries after an uncertain call-creation result.

### 7. Result

Lead with the self-reported outcome and human next action, not technical metadata.

#### Happy Medication Outcome

```text
Mdm Lim reports that she has taken her scheduled medication.
No follow-up is currently required.
```

#### Medication Uncertainty

```text
Mdm Lim is unsure whether she already took her medication.
CareCall did not provide dosage advice.
Joanne should contact her.
```

#### Food-Access Exception

```text
Mr Rahman reports that he has no food available.
Contact his care coordinator now.
```

Result fields:

- Self-reported outcome.
- Time of report.
- Confidence or ambiguity indicator.
- Follow-up requirement.
- Recommended human action.
- Short evidence excerpt.
- Call status.
- Masked phone number.
- Audit ID.

Raw transcripts and summaries are untrusted external data and must be rendered only as text.

### 8. Needs Attention

Group cases by operational urgency without claiming a clinical diagnosis.

#### Contact Now

- Senior reports feeling seriously unwell.
- Senior is confused about whether medication was already taken.
- No food is available.
- Repeated inability to reach the senior under an authorized escalation rule.

#### Follow Up Today

- Medication cannot be found.
- Meal delivery is missing.
- Senior requests a caregiver callback.
- Repeated reminder refusal.

#### Review When Available

- Conversation could not be classified.
- Technical call failure.
- Consent or schedule review is approaching.

Actions:

- Call caregiver.
- Call senior manually.
- Mark acknowledged.
- Add care note.
- Pause today's reminders.
- Escalate to coordinator.

No action may imply that emergency services, food delivery, or a caregiver visit has been arranged unless the action actually performed that external side effect.

### 9. Settings

Settings sections:

- Organisation identity.
- Caller identity and anti-scam wording.
- Operator roles.
- Default quiet hours.
- CALL-E connectivity.
- Scheduler configuration.
- Data retention.
- Transcript visibility.
- Escalation policies.
- Accessibility preferences.

## Care Circle

Each senior may have an ordered, explicitly authorized escalation circle:

1. Primary family caregiver.
2. Secondary family caregiver.
3. Active Ageing Centre coordinator.
4. Approved care provider.

Each member has:

- Relationship or role.
- Masked phone number.
- Permitted contact hours.
- Permitted escalation reasons.
- Priority.
- Active or paused state.
- Consent or authority record where required.

CareCall must not contact the whole circle simultaneously by default.

## Conversation Design

### Trust-First Opening

Example:

> Hello Mdm Lim. This is CareCall SG calling on behalf of Sunshine Active Ageing Centre. This is your scheduled lunch reminder. I will never ask for money, banking details, an OTP, password, or NRIC.

Optional later capability: a caregiver-selected trust phrase that the agent says to the senior. The agent never asks the senior to repeat or disclose the phrase.

### Medication Reminder

Example:

> This is a reminder for the medication scheduled by your care team for 1 PM. Have you already taken it as instructed, or are you unsure?

When unsure:

> I cannot advise whether to take another dose. I will ask your caregiver to contact you.

The agent must not say:

- `Take it now.`
- `Skip this dose.`
- `Take two later.`
- `It is safe.`
- `This medicine should be taken with food.`

### Meal Reminder

Example:

> Have you had lunch today?

When not yet eaten:

> Do you have food available and are you able to prepare or receive it?

If not, the agent requests human follow-up under the configured escalation policy.

### Closing Summary

The agent restates only what the senior reported:

> Thank you. I have recorded that you said you have eaten lunch. I will not make any other changes.

or:

> Thank you. I have recorded that you would like Joanne to call you. I have not given any medication advice.

## Outcome Contracts

### Medication Outcomes

- `self_reported_taken`
- `will_take_as_instructed`
- `unsure_if_taken`
- `cannot_find_medication`
- `declined`
- `requests_help`
- `feels_unwell`
- `no_answer`
- `failed`
- `timed_out`
- `uncertain`

### Meal Outcomes

- `self_reported_ate`
- `will_eat`
- `no_food_available`
- `cannot_prepare_food`
- `meal_delivery_missing`
- `not_feeling_well`
- `declined`
- `requests_help`
- `no_answer`
- `failed`
- `timed_out`
- `uncertain`

### Result Semantics

- `Self-reported` must remain visible in the result label.
- `No answer` is not refusal.
- `Call completed` is not routine completion.
- `Task completed` from the provider is not automatically a successful care outcome.
- Ambiguity routes to `uncertain` and human review.
- A request for help is not an emergency diagnosis.
- The app records what happened; it does not invent an action that was not completed.

## Data Model Direction

### Senior

```text
id
preferred_name
formal_name
form_of_address
phone_e164
preferred_language
timezone
quiet_hours
consent_status
consent_review_at
primary_caregiver_id
active
```

### Care Routine

```text
id
senior_id
type
display_label
scheduled_local_time
timezone
recurrence_rule
start_at
review_at
end_at
no_answer_policy
escalation_policy_id
active
created_by
```

### Scheduled Run

```text
id
routine_id
scheduled_for
request_key
authorization_basis
status
call_run_id
created_at
```

### Care Outcome

```text
id
scheduled_run_id
outcome_type
self_reported
confidence
follow_up_required
next_action
evidence_excerpt
recorded_at
```

### Escalation

```text
id
senior_id
scheduled_run_id
reason
priority
assigned_to
status
acknowledged_at
resolved_at
resolution_note
```

## Privacy and Security Requirements

- Require authenticated operator access before any live call.
- Apply server-side authorization to call creation, status lookup, transcripts, and care records.
- Rate-limit live call creation.
- Use atomic durable idempotency before creating a real call.
- Keep CALL-E credentials server-side.
- Mask phone numbers by default.
- Store the minimum health-related detail required for the reminder.
- Define transcript retention and deletion behavior.
- Do not use NRIC as an authentication secret.
- Log operator actions without logging raw credentials.
- Keep live-call and escalation audit records.
- Provide schedule pause, cancellation, and consent-withdrawal paths.
- Prevent a caregiver from accessing seniors outside their authorized scope.

## Apple-Style Utility Design System

The application is a utility dashboard. Motion and materials must accelerate the task rather than create a cinematic marketing experience.

### Principles

- Clarity: legibility and exact status language.
- Deference: content and human action lead; chrome stays quiet.
- Depth: layers distinguish navigation, sheets, and focused tasks.
- Restraint: remove decoration that does not communicate meaning.

### Color

- Light-first interface.
- Semantic tokens instead of literal colors in components.
- Neutral grouped page background.
- Solid content surfaces.
- One blue primary action accent.
- Green only for self-reported routine completion.
- Orange for human follow-up.
- Red only for genuine urgent escalation or destructive confirmation.
- Never use color as the only status signal.
- Support dark mode and increased contrast through semantic tokens.

### Typography

- System font stack: `-apple-system, system-ui, sans-serif`.
- Body: 17–18px.
- Secondary text: at least 15px.
- Section heading: 22–24px semibold.
- Page title: 30–34px bold.
- Body line height: approximately 1.45–1.55.
- No negative tracking on body text.
- Support browser zoom and text scaling without truncation.

### Layout

- 8px base spacing system.
- 4px half-step only for tight internal alignment.
- 16px control and card inset.
- 24px between related groups.
- 32–40px between major sections.
- Readable content widths.
- Sidebar plus master-detail on wide screens.
- Push navigation and a bottom or compact navigation model on narrow screens.
- Respect safe-area insets.
- Do not use a decorative bento grid for the operational dashboard.

### Components

- Minimum 44×44px interactive targets; prefer 48–52px for primary actions.
- Labels above inputs.
- Never use placeholder text as the only label.
- Strong `:focus-visible` treatment.
- Status pill includes text and, where useful, an icon.
- Destructive actions use a confirmation sheet.
- Recurring-schedule activation uses a focused sheet summarizing frequency and cancellation.
- Glass is limited to floating navigation or a focused sheet.
- Content cards remain solid.
- Provide an opaque reduced-transparency fallback.

### Motion

- Utility transitions only.
- Approximately 180–260ms spring-like state transitions.
- Immediate press feedback.
- Animate transform and opacity rather than layout.
- No parallax.
- No scroll-driven scenes.
- No scroll-jacking.
- No information depends on motion.
- Respect `prefers-reduced-motion`.

### Accessibility

- WCAG 2.2 AA target.
- Semantic HTML and accessible names.
- Logical heading hierarchy.
- Fully keyboard operable.
- Visible focus.
- Minimum 4.5:1 contrast for normal text.
- Error summary plus field-level errors.
- Error focus moves to the summary after submit.
- Status changes announced through an appropriate live region.
- Large text reflows without clipped controls.
- Avoid dense tables on narrow screens; convert rows to readable cards.
- No gesture-only action.
- No color-only meaning.

## Extended Product Ideas

### Exception-Only Caregiver Digest

Do not notify caregivers for every successful call.

Example:

```text
8 routines completed without action.
2 need your attention.
```

### Routine Confidence, Not Adherence Scoring

Do not assign punitive health scores. Show operational facts:

- Reminder reached.
- Self-reported complete.
- Human follow-up requested.
- Unable to reach.
- Routine paused.

### Scenario Simulator

Offline scenarios:

- Senior reports medication taken.
- Senior is unsure whether medication was already taken.
- Senior reports eating.
- No food is available.
- Meal delivery is missing.
- Senior requests a caregiver.
- Senior feels unwell.
- No answer.
- Call failure.
- Ambiguous result.

The simulator must exercise the same outcome mapper and result screens as the live path.

### Trust Phrase

Later capability: a caregiver-selected phrase spoken by the agent. It is a reassurance mechanism, not an authentication secret. The senior is never asked to reveal it.

### Temporary Care Overrides

- Pause reminders during hospitalization or travel.
- Skip one occurrence without deleting recurrence.
- Temporary caregiver substitution.
- Temporary language or call-window adjustment.

All overrides require an audit record and a visible expiry.

## Recommended Demo Scenario

Use fictional records and one consenting team member's phone.

### Happy Path

1. Operator opens Today.
2. Mdm Lim's lunch check-in is due.
3. Operator reviews the masked dry-run preview.
4. Operator authorizes exactly one call.
5. CALL-E calls the consenting recipient.
6. Recipient reports having eaten.
7. Result states `Self-reported ate` and requires no follow-up.

### Safety Path

Simulate a senior who is unsure whether medication was already taken.

The result must state:

- CareCall provided no dosage instruction.
- The outcome is `unsure_if_taken`.
- A caregiver callback is required.
- No medication completion is claimed.

## Implementation Phases

### Phase 1: Product Shell

- Rename the application to CareCall SG.
- Replace the landing page with Today.
- Add navigation shell.
- Add fictional senior fixtures.
- Add responsive master-detail layout.
- Establish semantic design tokens.

### Phase 2: Care Domain

- Add senior profiles.
- Add care circles.
- Add medication and meal routines.
- Add schedule lifecycle states.
- Add Singapore date and time formatting.

### Phase 3: Safe Offline Flow

- Add dry-run preview.
- Add one-call and schedule authorization.
- Add scenario simulator.
- Add self-reported outcome contracts.
- Add Needs Attention routing.

### Phase 4: CALL-E Integration

- Generate medication and meal call goals.
- Add trust-first call opening.
- Add explicit medical and anti-scam boundaries.
- Map provider status separately from care outcome.
- Parse results conservatively.
- Add activity milestones.
- Add unknown-creation reconciliation.

### Phase 5: Security and Recurrence

- Add operator authentication.
- Add role and senior-scope authorization.
- Add rate limiting.
- Add durable atomic idempotency.
- Add host-owned scheduler integration.
- Add pause, update, and delete behavior.

### Phase 6: Accessibility and Verification

- Keyboard and screen-reader audit.
- Large-text and zoom audit.
- Contrast audit.
- Reduced-motion and reduced-transparency audit.
- Responsive audit.
- One consenting live medication reminder.
- One consenting live meal check-in.
- Verify no secrets or personal data are committed.

## Definition of Done

- A caregiver can enrol a fictional senior and configure a care routine.
- Dry run is the default.
- One live call requires explicit authorization.
- Recurrence requires separate explicit authorization.
- Every recurring routine can be paused, updated without duplication, and deleted.
- CALL-E is called at runtime in the deployed app.
- Medication uncertainty never produces dosage advice.
- Results use `Self-reported` language.
- Meal check-ins identify lack of access or failed delivery.
- Human exceptions appear in Needs Attention with a clear next action.
- Emergency language does not claim to dispatch help.
- The live endpoint is authenticated, authorized, rate-limited, and idempotent.
- Phone numbers are masked by default.
- No secrets, real phone numbers, private transcripts, or health records are committed.
- Default tests require no credentials and place no calls.
- Product UI meets the accessibility requirements above.
- Repository validation passes.

## Immediate Next Step

Begin Phase 1 by restructuring the current Agent Gallery shell into CareCall SG with:

1. Semantic design tokens.
2. Responsive navigation.
3. Today dashboard.
4. Fictional senior fixtures.
5. A reusable status and care-timeline component.

Do not connect new screens to live CALL-E execution until the dry-run care-domain flow and safety outcomes are working offline.
