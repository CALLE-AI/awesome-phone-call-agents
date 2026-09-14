# Safety

- One disclosed call per order attempt. The caller says which business it represents and that it is an AI assistant.
- The phone number must come from the order record and be E.164. Mask phones in logs, screenshots and video.
- Items, prices and totals are read from the **order rows**. Never let a language model summarise the chat into the brief.
- Never collect card numbers, ID numbers, or take payment on the call. Cash on delivery stays cash on delivery.
- Never commit `CALLE_API_KEY`. Keep it in the server environment; the browser never sees it.
- Dry-run by default. Live calls only after explicit authorization, and preferably with a verified-number override during demos and testing.
- Fail closed: silence, voicemail, no answer, wrong number, schema drift and low completion confidence are `needs_human`, never a confirmation and never a cancellation.
- Only `disposition = confirmed` with `confirmed = yes` and high confidence may flip an order to confirmed. Cancelling on the phone result is optional and must be a deliberate rule of the calling system.
- Respect opt-outs and blocks before a task exists. Respect CALL-E's supported-country list.
- Bound spend with a per-tenant daily cap and a delay after the order lands so the customer can finish the chat first.
- No hidden retries, no recurring schedules. A second attempt is a new, human-approved task with a new idempotency key.
- Out of scope: medical, legal, financial, collections, political and unsolicited marketing calls.
