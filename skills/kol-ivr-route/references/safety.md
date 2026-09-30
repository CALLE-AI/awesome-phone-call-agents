# Safety

## Before dialling

- Use fixture data by default. Never paste PHI, member IDs, birth dates, real claim numbers, or credentials into a prompt, issue, log, or committed file.
- Call only a number the user owns or is authorised to test. Repeat the masked destination and the purpose before submission.
- Require the exact E.164 destination twice (`--to` and `--authorise`). A vague “yes” is insufficient.
- Explain that a live call can cost money and ring another party. The public CALL-E Developer API used by Kol has no documented cancellation operation once the call is accepted.
- Do not automatically retry an ambiguous create request. Reconcile the original call or idempotency key in the CALL-E dashboard first.

## After dialling

- Store raw transcripts as sensitive data outside version control. Apply encryption, access control, retention, and deletion policies appropriate to the deployment.
- Do not let model-generated structured output verify itself. A provider event counts only when its keypress data is produced independently of the model extraction.
- Fail closed on missing evidence, mismatched departments, stale routes, conflicting amounts, low confidence, or an unasked question.
- A human remains responsible for any claim-record update, appeal, payment posting, or patient communication.

## Production boundary

This repository does not claim HIPAA compliance. Production use needs payer authorisation, appropriate contracts and agreements, threat modelling, access logging, incident response, and counsel familiar with healthcare privacy and call-recording law.
