# Regions

CALL-E does not support every ISO country. Posting an unsupported destination wastes credits and can fail on the wire. This skill **refuses locally** instead.

Yemen (`YE`, calling code `+967`) is never eligible. Name it in previews as `unsupportedRegion`. Do not dial and hope.

## Rules

1. `region` on the intake JSON is required. It is an ISO 3166-1 alpha-2 code.
2. Do **not** infer `US` (or `CA`) from a leading `+1`. NANP covers more than one country. The operator must state the region.
3. If `region` is `YE`, or the E.164 calling code maps to YE, refuse with `unsupportedRegion` and `status: not_called`.
4. If `region` is not in the supported set (CALL-E GitHub snapshot Sep 2026 plus EG), refuse the same way.
5. If the number is NANP (`+1…`) the stated region must still be a supported ISO (typically `US` or `CA`). A mismatch is `unsupportedRegion`.

## Supported ISO codes (snapshot)

AE AU BD BR BW CA CM DE EG ES FI FR GB GH HN ID IE IL IN JP KE LK MX MY MZ NA NG NL OM PH PK PL SA SG TH TN TR TW UA US VN ZA

YE is intentionally absent.

## Dual rail is out of this skill

A host app may use another channel or its own UI for an unsupported row. That is out of this skill. The skill's job is: **do not POST**.
