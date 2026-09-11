# PositiveContact Demo Script

Target length: 2 minutes 35 seconds. Keep the browser at 125% or less so the full cards
fit on screen. Record fixture mode only; do not place a real call for the video.

## Before recording

Check the public read-only demo at
`https://positive-contact-demo.onrender.com/`. Record the local fixture below for the
operator authorization sequence because the public process intentionally has no forms or
action buttons.

```bash
cd apps/python/positive-contact
python3 -m venv /tmp/positive-contact-venv
/tmp/positive-contact-venv/bin/pip install -e ".[dev]"
/tmp/positive-contact-venv/bin/pc run --mode fixture \
  --stop-before-cutoff --db /tmp/positive-contact-video.db
/tmp/positive-contact-venv/bin/pc serve \
  --mode fixture --db /tmp/positive-contact-video.db --port 8000
```

Open `http://127.0.0.1:8000/board`. In a second tab, open
`http://127.0.0.1:8000/api/v1/status`.

## Shot list and narration

### 0:00-0:22 - Contact ladder

"A power shutoff warning is not successful because a call completed. A person must hear
and acknowledge it. PositiveContact uses CALL-E for the conversation, then keeps a durable
ladder until we have proof or a field visit. Voicemail never counts."

Point to the summary cards and two different contact states.

### 0:22-0:52 - Human review

Open **Human review** and find the powered-equipment case.

"This resident asked a medical question. The agent did not give advice and did not collect
a diagnosis, medicine name, dose or equipment model. It captured four safe facts: a coded
route, broad timing, permission to contact a provider and whether there is immediate
danger. Emergency risk never enters supplier automation."

Point to the safety boundary, consent and evidence span.

### 0:52-1:33 - One provider call

Open **Support desk**. Select **Northbay Equipment Support (demo)**, enter `demo-op`, tick
the authorization statement and click **Authorize provider call**.

"A named operator, not the agent, chooses an allowlisted provider and authorizes exactly
one call. The CALL-E task contains no resident name, number, address or clinical detail. It
only asks whether the provider can accept a general outage-support referral. This is an
offline CALL-E-shaped fixture, so the demo spends no credit and calls nobody."

After the result appears:

"The structured result gives availability, a broad response window and public
instructions. It does not order or reserve anything. A person owns the next step."

### 1:33-1:58 - Evidence report

Open **Evidence report**.

"The same ledger tracks acknowledgements, retries, human decisions, support requests and
field visits. Every metric carries its denominator. A completed call alone can never become
a confirmed contact."

Point to `Positive contact confirmed` and `Calls placed`.

### 1:58-2:22 - Integration and safety

Switch to the status API tab, then briefly show `positive_contact/transports/calle.py` and
`positive_contact/support.py` in the editor.

"The live path calls CALL-E's REST API with strict result schemas and stable idempotency
keys. Webhooks are wake-ups; the app re-reads the call before acting. Live mode also needs
an environment gate, an explicit flag, a hard call ceiling and the typed word PLACE."

### 2:22-2:35 - Close

Return to the Support desk result.

"PositiveContact turns a warning call into a closed real-world workflow: hear the notice,
prove it, coordinate practical help safely and send a person when the phone is not enough."

## Recording checks

- Keep the video under three minutes.
- Say that the recorded provider call is a fixture. Do not describe it as a live result.
- Show no API key, raw phone number, email address or browser account.
- Use a public YouTube or Vimeo URL and verify it in a signed-out window.
- Capture one clean frame each from Contact ladder, Human review, Support desk and Evidence
  report for the Devpost gallery.
