# Response fixtures

`templates.json` contains synthetic CALL-E-shaped JSON response templates. Placeholder hydration is allowed only for these explicitly synthetic templates so editable rehearsal inputs remain useful. It covers success, unknown offer, no answer, decline and an invalid pickup time. No successful live call is implied.

`recorded-route-rejection.json` is the actual observed CALL-E SDK error for English calling to an authorized Sri Lankan test number on September 12, 2026. Input contact values are replaced with fictional reserved numbers and role names. It contains no completed call or invented call ID. Its capture manifest hashes the redacted input, error, response list and matching clock.

Successful real-call recordings will be created automatically under private `data/recordings/` by `PhoneAdapter`. No manual pasting of provider JSON is needed. The harness can replay them directly with zero phone calls. Original response values stay unchanged after the recorder's consistent redaction. The integrity hash is not an authenticity signature, and private speech still requires review before public sharing.
