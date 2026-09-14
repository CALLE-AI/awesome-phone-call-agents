# SwiftCure

Healthcare, without the phone tag.

SwiftCure uses CALL-E to contact hospitals on behalf of prospective patients, gather appointment availability, consultation costs, required documents, and specialist information, then present a side-by-side comparison.

## Features

- Real CALL-E hospital phone calls
- Specialist availability checks
- Appointment and walk-in information
- Consultation cost estimates
- Document requirements
- Full call transcripts
- Side-by-side hospital comparison

## Reference scope and no-call evaluation

This entry links to an external Hackathon prototype; no executable is included here. The linked version is live-only: it has no sample-comparison, preview, or dry-run mode. For no-call evaluation, inspect its README, source, and synthetic directory fixtures without starting an authenticated server or submitting the form.

## Live Mode

Submitting the external app's form can place multiple real CALL-E phone calls and consume credits. Use only explicitly authorized test destinations, never the bundled directory as a live recipient list. The upstream setup requires an authenticated CALL-E CLI and currently uses Windows-specific shell syntax.

The prototype retries submissions and advances through its hospital list, including after uncertain results; it does not provide a reliable unknown-outcome stop. Do not use that path for real patient workflows. A started call cannot be recalled by closing the page; reconcile any uncertain attempt with the provider before another call. Extracted costs, availability, and transcript highlights are experimental, advisory observations that a person must verify, not medical advice or a confirmed appointment.

## Repository

https://github.com/Nazma-shaik-13/SwiftCure
