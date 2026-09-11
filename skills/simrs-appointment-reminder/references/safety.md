# Safety — SIMRS Appointment Reminder

## Patient Consent

Every patient phone number in the appointment list must come from a healthcare record where the patient has consented to automated appointment reminders. This consent may be collected during registration, admission, or through a separate opt-in form.

If consent status is unknown, skip the patient and flag the record for staff review.

## No Medical Advice

The CALL-E call script must never:

- suggest medications, dosages, or treatment changes
- interpret symptoms or provide diagnostic opinions
- recommend specific medical procedures
- discuss lab results, imaging findings, or clinical notes
- make statements that could be interpreted as medical advice

If a patient asks a medical question during the call, the AI must respond:

> "Mohon maaf, saya hanya bisa membantu mengingatkan jadwal janji temu. Untuk pertanyaan medis, silakan hubungi dokter Bapak/Ibu langsung atau datang ke rumah sakit."

## Privacy and Data Handling

- Do not include full patient names in CALL-E metadata or request IDs.
- Use appointment IDs (e.g., `APT-20260728-001`) as the primary identifier in call payloads.
- Do not store call transcripts containing health information in external systems.
- Phone numbers must be masked in all user-facing summaries: `+62 859****1919`.
- Do not pass patient NIK (national ID), MRN (medical record number), or insurance numbers through CALL-E.

## Calling Hours

Default calling window: **08:00–20:00** in the patient's local timezone.

If the patient's timezone is unknown, use the hospital's timezone.

Do not call on national public holidays unless the hospital specifically authorizes it.

## Retry Policy

- Maximum **2 retry attempts** per appointment.
- Minimum **2 hours** between retry attempts.
- After 2 failed attempts, mark as `CONTACT_ERROR` and notify hospital staff.
- Do not retry if the patient explicitly asked not to be called again.

## Emergency Handling

If a patient describes a medical emergency during the call (chest pain, difficulty breathing, severe bleeding, loss of consciousness), the AI must:

1. Stop the appointment reminder flow immediately.
2. Respond: "Sepertinya ini darurat. Segera hubungi 112 atau pergi ke IGD terdekat. Saya akan mengakhiri panggilan ini."
3. End the call.
4. Flag the record with `EMERGENCY_REPORTED` status for immediate staff follow-up.

## Third-Party Calls

Do not call family members, caregivers, or emergency contacts unless:

1. The patient's record explicitly authorizes a third-party contact.
2. The primary patient phone number is unreachable after the first retry attempt.
3. Hospital policy permits third-party reminder calls.

## Data Retention

- Call outcome data (confirmed/rescheduled/cancelled) may be stored in SIMRS indefinitely as part of the appointment record.
- Raw call transcripts must be purged after **30 days** unless the hospital's data retention policy specifies otherwise.
- CALL-E call IDs should be stored for audit purposes but not linked to patient health records.
