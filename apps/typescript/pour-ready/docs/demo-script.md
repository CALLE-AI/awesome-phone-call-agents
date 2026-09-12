# Three-minute demo script

## Scope note

The current recording plan is dry-run only. There is no authorized live call in
this build, so no live-call excerpt is recorded or claimed. If an authorized
live call is captured later, add it as a separately labeled segment and update
the Devpost packet at the same time. Keep every label accurate: a fixture path
is described as fixture.

## 0:00–0:30 — The failure mode

"A concrete pour is an expensive chain of verbal commitments. The schedule can
look green while the site, supplier, pump, and tester are each working from a
different version of the plan. One late pump can leave trucks waiting and
concrete aging."

Show the fictional Harbour Point pour: Singapore, 06:30, 85 m³, mix C40 /
P-217.

## 0:30–1:10 — Inspect before any side effect

Open **Preview call plan**. Point out that every role receives a bounded,
role-specific checklist. Show the automated-assistant disclosure and the
authority boundary.

Keep dry-run selected. Optionally show the live-mode panel to explain the
gating, and say plainly that the live path is not part of this recording.

## 1:10–1:45 — CALL-E at runtime

Start the run. The four cards move through queued, calling, and completed.

Say that this is the deterministic fixture path: no credential is read and no
call is placed. Point to the code path in `src/lib/calle-server.ts` or the test
suite as the evidence that CALL-E is imported and called for real, rather than
showing a call that did not happen.

## 1:45–2:30 — Reveal the contradiction

The board changes to `CONFLICT`. Site, dispatch, and testing report 06:30. The
pump operator explicitly reports 08:00 because of an earlier job.

Open the pump evidence and say: "This is not an AI forecast. It is the contact's
reported commitment, returned in a strict schema and linked to redacted
evidence."

## 2:30–3:00 — Human control and market wedge

Select **Hold**. Show the timestamped audit event.

"PourReady never approves a pour. It makes hidden verbal disagreement visible
early enough for a supervisor to act. Pre-pour concrete is the wedge; the same
four-call coordination pattern applies anywhere one operation depends on
multiple external parties agreeing to the same plan."

Close with evidence-backed demand, clearly separating published industry
requirements from interview results. Do not claim an authorized live call or
customer interview until it has actually happened.

## Recording checklist

- Keep the recorded path dry-run, and label it as such on screen and in speech.
- Never display an unmasked number or an API credential.
- Do not imply that the fixture path is a live call. Show the runtime integration
  through code or tests instead.
- If a live call is authorized later, record it separately, label it as live, and
  revise this script and the Devpost packet before publishing.
- Rehearse on fixtures first so the recorded takes stay inside three minutes.
- Mention that a submitted live call cannot be canceled from this client.
