# Bundled workshop replay format, version 1

The R6A reader is a read-only view over a curated **SYNTHETIC_REPLAY_FIXTURE**. It exercises replay loading and evidence presentation before a real recording exists. Its dates, company names and transcript are fictional.

`src/fixtures/workshop-replay.json` contains one closed catalog with schema version, synthetic mode, fixture revision, originating source commit, a fixed case reference and observation context, zero service/call counters and four ordered terminal scenarios. The content originated from `src/fixtures/workshop.ts` at `c6111870f92aefdc5995bca6054e036c74dca4eb`. The observation time is part of the fictional scenario, not a real capture timestamp. Server contracts are explicitly `UNOBSERVED`.

The catalog is UTF-8 with LF line endings, enforced by `.gitattributes`. Its SHA-256 is pinned separately in `workshop-replay-catalog.ts`. The reader limits input to 16,384 UTF-8 bytes, checks that digest, rejects missing/extra keys, unknown versions or source revisions, nonterminal or duplicate/reordered cases, invalid context, nonzero network claims and invalid/bounded transcript lines. It derives all result fields and draft sentences with the existing workshop interpreter; the file cannot supply precomputed promises or HTML. Text is escaped before rendering.

The four catalog scenarios must match the executable demo transcript corpus. Tests exercise both integrity rejection and schema rejection with newly computed hashes, so a matching hash does not bypass the schema. Failure displays a closed error state with no loaded outcome and no fallback request.

A hash proves consistency with the curator's selected bytes. It is not a digital signature, independent authenticity check or proof of a call. The code is not an arbitrary-file sanitizer and does not accept uploads, remote URLs or a LIVE/SANITIZED_REPLAY mode.

After an authorized representative call, R6B must prepare a separately reviewed sanitized record, include actual capture/source and contract provenance, verify every retained excerpt against the private evidence, qualify the interpretation on that actual material, and deliberately extend the accepted format/catalog. A label change is insufficient. Opaque plan/run/session identifiers, telephone numbers, tokens, account information and private raw responses cannot enter that public fixture.
