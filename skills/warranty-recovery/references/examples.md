# Examples

Four synthetic calls. Every number is from the reserved fictional 555-0100 to
555-0199 block, every name is invented, and no example here came from a real
call. Runnable versions live in `apps/python/warrantyops/fixtures/`.

## A. The portal was wrong

Recipient `+1 202 555 0142`. The portal had no record of the serial. The
distributor finds it, confirms coverage, raises an authorization, reads it back
when asked, and gives a return window but no shipping date.

```text
"Yes, that unit is still inside the five year parts warranty, I have it here."
"I can raise a return authorization for you now."
"Correct, that is RMA four eight one seven one."
"We need the failed unit back within thirty days of the authorization date."
```

```json
{
  "coverage_status": "COVERED",
  "resolution_status": "RMA_ISSUED",
  "authorization_reference": "RMA-48171",
  "replacement_eta": null,
  "return_deadline": "within thirty days of the authorization date"
}
```

`replacement_eta` stays null because nobody said one. An unknown that is
labelled unknown is a usable result.

## B. They need a photograph first

Recipient `+1 415 555 0118`. The representative cannot see a coverage record.

```text
"I am not able to confirm coverage from what I have on screen."
"Send me a photograph of the serial plate and the installation invoice."
```

```json
{
  "coverage_status": "UNKNOWN",
  "resolution_status": "DOCUMENTATION_REQUIRED",
  "authorization_reference": null,
  "required_documents": ["photograph of the serial plate", "installation invoice"]
}
```

No reference was given, so none is reported. There is no such thing as a
provisional RMA.

## C. A hedge is not a yes

Recipient `+1 415 555 0127`.

```text
"It should probably be covered, but I cannot confirm without the installation record."
```

```json
{
  "coverage_status": "UNKNOWN",
  "resolution_status": "DOCUMENTATION_REQUIRED"
}
```

The sentence contains the word "covered" and means nothing of the kind. This is
the case a summariser gets wrong and a contract with an explicit `UNKNOWN` gets
right.

## D. The read-back earns its keep

Recipient `+1 202 555 0163`. The reference is said once, quickly, and heard
wrong.

```text
"Right, your authorization is four eight one seven one."
"No, that last digit is an eight. Four eight one seven eight, that is correct."
```

```json
{
  "coverage_status": "COVERED",
  "resolution_status": "REPLACEMENT_APPROVED",
  "authorization_reference": "RMA-48178"
}
```

The value first heard was `RMA-48171`. It is kept beside the confirmed one and
marked as corrected. Without the read-back, this call would have produced a
schema-valid, confidently extracted, factually wrong authorization, and the
replacement would have shipped against a number that belongs to somebody else.
