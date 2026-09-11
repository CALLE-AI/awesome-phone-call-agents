# CallAction CI/CD Escalation

A GitHub Action that halts a failing CI pipeline, places a consent-first live CALL-E call to the on-call engineer, and posts their decision back to the Pull Request.

## Setup & Usage

Add this step to your GitHub Actions workflow. It is designed to run only when previous steps fail.

```yaml
- name: Trigger CallAction on Failure
  if: failure()
  uses: CALLE-AI/awesome-phone-call-agents/apps/typescript/callaction@main
  with:
    calle_api_key: ${{ secrets.CALLE_API_KEY }}
    phone_number: ${{ secrets.ON_CALL_PHONE }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Side Effects

* Outbound Calls: Places exactly ONE real outbound phone call per failed CI run to the configured phone_number.
* GitHub Comments: Posts exactly ONE comment to the triggering GitHub Pull Request containing the call status and the engineer's decision.

## Credentials

* Requires CALLE_API_KEY to be passed securely as a GitHub Secret.
* Requires the standard GITHUB_TOKEN to post PR comments.
* No credentials are logged or stored in workflow artifacts.

## Cancellation & Rollback

* The GitHub Action can be canceled via the GitHub Actions UI. However, if the createAndWait API call has already been dispatched to CALL-E, the physical phone call will proceed to completion. The PR comment will simply not be posted.
* There are no recurring schedules created by this tool.

## Safety & Boundaries

* Phone Validation: Enforces strict E.164 phone validation (e.g., +12025550123). Rejects +0 and malformed numbers before dialing.
* Data Masking: Masks phone numbers in all GitHub workflow logs and PR comments (e.g., +12******123).
* Idempotency: Uses github.run_id as a stable idempotency key (callaction-escalate-<runId>). Retrying the workflow job will not create a duplicate call; it will safely fetch the existing call result.
* Fail-Closed Disposition: If the call hits voicemail, drops, fails to reach the right person, or yields an unrecognized output, the workflow fails closed (needs_human) rather than assuming the issue is resolved.