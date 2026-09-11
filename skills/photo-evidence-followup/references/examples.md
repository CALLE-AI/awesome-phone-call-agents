# Examples

All numbers are fictional reserved examples. A real call requires the actual recipient's consent and the user's approval of the exact preview.

## Blurred photo

The trace returns `REQUEST_RETAKE`. The preview asks the parcel owner for a sharp overhead photo in even lighting through the existing order portal. It masks `+14165550199` as `+14*******199`. A clear `yes` produces `WAIT_FOR_SECURE_UPLOAD`; voicemail, refusal, or uncertainty produces `HUMAN_REVIEW` and no retry.

## Missing shipment label

The trace returns `REQUEST_LABEL_PHOTO`. The preview requests one close label photo with account and address details covered. The call does not ask the recipient to read the label, address, tracking token, or account details aloud.

## Existing decision

The trace returns `STAGE_CLAIM_PACKET`. The preview returns `call_needed: false` because the visual evidence already supports the next human-review step. No CALL-E plan is created.

## Unsupported trace

The trace returns an unknown or malformed action. The workflow stops with `call_needed: false`; it does not invent a photo request from free-form trace text.
