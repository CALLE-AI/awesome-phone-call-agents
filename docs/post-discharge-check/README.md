# Post-Discharge Check (PDC) simulation reference

This is a documentation-only pointer to an external CALL-E Hackathon interface
prototype: [public source](https://github.com/cloudnewbie/PDC) and
[hosted demo](https://cloudnewbie.github.io/PDC/). No runnable application is
bundled in this repository contribution.

## Scope

The no-key mode replays a scripted, synthetic post-discharge check-in through a
React care-team interface. It illustrates transcript turns, advisory symptom
flags, structured fields, a campaign/cadence view, and a local escalation inbox.
All example patients and conversations are simulated. These screens do not prove
that a real scheduler, patient identity verification, nurse paging, clinical
triage, or EHR writeback has been implemented or validated.

This is not a medical device or a source of clinical advice. Simulated confidence
scores and red flags are demonstration data, not reliable patient assessments.
Do not use the prototype to make or automatically execute care decisions.

## Explore without calling

Use a fresh browser profile with no saved CALL-E key, or run the external project
locally with no `VITE_CALLE_API_KEY` and no existing browser-stored key:

```bash
git clone https://github.com/cloudnewbie/PDC.git
cd PDC/app
npm ci
npm run dev
```

Open `http://localhost:3000` and verify that the interface says **Demo Simulation**
before starting a walkthrough. Use only the built-in fictional examples. Do not
paste a key into Settings, supply a real phone number, or upload patient records.
Stop if the interface indicates live mode. Dependency installation may use the
network; the documented walkthrough requires no CALL-E account or real call.

For a manual check, start the synthetic conversation and observe transcript
updates, advisory flags, and the local result/inbox views. This checks the
simulation experience, not a live telephony or clinical integration.

## External live path and credentials

The external source also contains an experimental browser-side live adapter.
Supplying a key can activate real calls and spend credits; that path is outside
this catalog entry's supported simulation workflow and has not been validated
here. It is not a safe way to publish a deployment with a shared secret.

`VITE_` variables are exposed to browser code during a Vite build, not confined
to a server environment. A runtime key in localStorage is also available to code
running in that page. Never embed a real CALL-E key in a public build or enter
credentials into the hosted demo. A real care integration needs its own reviewed
credential, recipient authorization, privacy, and clinical boundaries.

## Side effects and limitations

- The synthetic walkthrough places no call or clinical mutation. Cadence and
  escalation screens are illustrative local UI behavior, not a guarantee of
  scheduled outreach or nurse notification.
- Closing or stopping the simulation stops the local walkthrough. This must not
  be interpreted as proof that an already submitted real call has been canceled.
- External claims about live API compatibility, timing, identity checks,
  idempotency, or care outcomes are author-reported and not independently verified
  by this reference. A best-effort cancel attempt does not guarantee recall, and
  a newly generated request key does not prove that repeated attempts are deduped.
- The linked project is a community prototype, not a production certification.
  Its implementation may change independently of this repository.
