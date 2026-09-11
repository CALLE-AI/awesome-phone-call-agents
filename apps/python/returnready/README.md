# ReturnReady

Compare five quoted return instructions with the written record, inspect later corrections, and export unresolved questions before a package moves. Matching wording never authorizes shipment.

## Run locally

Python 3.11 or newer, standard library only:

```sh
cd apps/python/returnready
python returnready.py
```

Open the printed localhost address. Default mode needs no API key and makes no provider calls. The example conversations, identifiers, dates, durations and call-like metadata included here are wholly synthetic. They are not redacted provider results or evidence from a real enquiry.

## Complete review workflow

Load written instructions and an example result. Inspect authorization, destination, shipping payer, absolute deadline and refund/replacement conditions beside exact recipient quotations. Later corrections remain visible and remove earlier apparent matches. Caller speech and generated summaries are not recipient evidence. Download a review, save the inputs, then reopen to recompute freshness and findings. Editing inputs invalidates old exports. Fingerprints identify bytes, not consent, identity or truth.

## CALL-E integration

A connected host may use CALL-E's supported planning and confirmation tools, retain the actual run ID and read that same run after it finishes. The operator-mediated importer accepts the narrow result format through Inspect the data, or the CLI in docs/MCP-RESULT-IMPORT.md.

Unknown permission, provider errors or a blocked next step result in a hold. Transcript and extracted claims are withheld from the normalized review. For permitted imports, separately reviewed annotations need exact quotations and turn indices. The importer cannot terminate an active call, erase provider recordings or authenticate an operator-supplied file. Do not publish operational call records in this repository.

The optional REST adapter is not validated against a live CALL-E service by these tests. Live mode requires CALLE_API_KEY on the server, the explicit --live flag, authorization for the specific recipient, a reviewed preview, exact confirmation and the supplied recipient-local 09:00 to 18:00 window. See python returnready.py --help. The SQLite ledger records intent before the provider request, does not retry uncertain starts and retains the first terminal observation. Only an unstarted preview can be cancelled here; active calls require provider controls.

Phone inputs require an ASCII plus sign and ASCII digits, without surrounding whitespace. Reserved fictional numbers are never sent by the live transport. The reserved UK London drama fixture is used only in injected request spies and loopback wire tests. Syntax validation is not country availability, subscriber verification or permission to call. Ofcom's reserved sample ranges: https://www.ofcom.org.uk/phones-and-broadband/phone-numbers/numbers-for-drama

## Reproduce checks

```sh
python -m unittest test_returnready http_test test_completion test_mcp_import test_review_fixes -v
python -m pip install playwright==1.55.0
python -m playwright install chromium
python browser_completion.py
python browser_mcp.py
```

Run python scripts/validate_repository.py from the repository root as well. Browser tests use actual localhost HTTP, actual downloads and the default security policy. All call-like data is fabricated. Output artifacts are ignored by Git and do not belong in the contribution. These checks do not establish live-service compatibility, customer adoption or representative accuracy.

## Scope and provenance

Conservative English lexical review can miss unseen revisions and flag benign wording. No purchase, refund, courier booking, fee acceptance or automatic shipping permission is performed. The software does not make medical, legal, financial or emergency decisions. It is a reference app, not a supported provider SDK.

Original code by Joseph Ayanda, developed with substantial AI assistance, under the MIT license. Review and persistence behavior is retained. Reviewer corrections enforce ASCII inputs and remove operational artifacts from the contribution history. No transcript, recording, real-call date/duration/outcome or provider identifier is included as a repository example.
