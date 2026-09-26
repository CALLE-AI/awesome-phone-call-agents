# Safety

- Fixture / dry-run by default; never dial without an explicit live path and `CALLE_API_KEY`.
- Require per-appointment `consent: true` and an authorized E.164 number from the booking workflow.
- Mask phone numbers in logs and demos.
- Disclose the business name and that this is a confirmation of an existing appointment.
- No medical, legal, financial, emergency, collections, or political content.
- No payment or ID collection on the call.
- One planned call per appointment; no hidden campaigns or recurrence.
- Calendar create/move/cancel stays with a human after reviewing structured results.
