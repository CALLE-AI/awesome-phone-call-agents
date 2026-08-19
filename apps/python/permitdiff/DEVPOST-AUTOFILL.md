# PermitDiff — Devpost autofill

Use these values for the CALL-E submission form.

- Submitter Type: Individual
- Country of residence/incorporation: Hong Kong
- Organization name: leave blank
- App status: Newly created
- If pre-existing, explain updates: Not applicable — PermitDiff was newly created during the submission period.
- Functional demo URL: https://permitdiff.vercel.app
- Project submission pull request URL: https://github.com/CALLE-AI/awesome-phone-call-agents/pull/199
- Email associated with CALL-E account: contact@example.com
- Primary use case: Workflow & back-office automation
- One-sentence real-world task: Reconciles stale or conflicting permit-portal snapshots with one authorized evidence-bound CALL-E office call and surfaces discrepancies without changing official permit state.
- Eligible Age: confirmed true by submitter
- Country eligibility: confirmed true by submitter
- Conflict of interest: confirmed true by submitter
- Demo video URL: TODO — public YouTube or Vimeo, about 3 minutes

## Testing instructions
1. Clone branch `agent/permitdiff` and enter `apps/python/permitdiff`.
2. Use Python 3.11+.
3. Run `python -m pytest -q`.
4. Run `python permitdiff.py --request example-request.json`; preview is default and creates no call.
5. Open the public deterministic judge console: https://permitdiff.vercel.app
6. Exercise Fresh record, Stale + match, and Stale + discrepancy; verify the final state still requires official-record confirmation.
7. Any live call requires applicant-side authorization for the exact permit case and the documented allowlist/live gates.
