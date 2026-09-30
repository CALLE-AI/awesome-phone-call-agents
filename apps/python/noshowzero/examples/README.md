# Examples

Everything here is fictional. Phone numbers are in the NANP `555-0100`-`555-0199` block reserved
for fiction, and the clinic, patients and calls are invented.

- `clinic.json` - the clinic: name, timezone (reminder times are spoken in it), callback number.
- `appointment.json` - one appointment, including the patient's `consent_to_call`.
- `waitlist.json` - four waitlist entries, chosen so each matching rule is visible in
  `python cli.py --offer`: a morning-only patient, a different service, a patient without
  `consent_to_call`, and the one afternoon match.
- `fictional_reminder_call.json` and `fictional_offer_call.json` - terminal CALL-E call tasks shaped
  like `GET /v1/calls/{id}` responses. They were written by hand for the offline replay path; they
  are not recordings of real calls.
