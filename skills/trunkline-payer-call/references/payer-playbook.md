# Payer phone playbook

Notes on the parts of a payer call that a general-purpose calling prompt gets wrong.

## The menu

Health plan provider lines separate providers from members at the first branch, and then split claims, eligibility, and authorizations. Answer as a provider billing office.

Menus commonly ask for the NPI on the keypad, sometimes the tax identification number, and sometimes the member id before a representative is offered. Supply the NPI, which is public registry information. Do not supply a tax identification number from a workflow that does not carry one; record the request and end the call.

Some menus offer a self-service claim-status readout. It is usually less complete than a representative and cannot explain a denial. Take the representative when one is offered.

If the menu ends the call by directing the caller to the provider portal with no representative option, that is `ivr_dead_end`. It is a real outcome, not a failure to try, and it tells the practice something worth knowing about that payer.

## The hold

This is most of the call. Three rules:

1. **Do not speak to hold music.** A recorded message is not a person. Wait silently.
2. **Count all of it.** A transfer drops the call into a second queue, so cumulative hold matters, not the first stretch.
3. **Have a limit and report hitting it.** CALL-E exposes no hard hold ceiling, so the limit lives in the task text and the agent is asked to honour it. Keep an outer wall-clock bound in your own polling loop as well.

An announced estimate ("your wait is about twenty minutes") is worth capturing. Over time it tells you which hours are cheap for which payer.

## Callbacks

Many payers offer to call back instead of holding. CALL-E is outbound-only, so there is nothing to catch the return call. Decline and stay in the queue.

## The representative

Expect to verify twice. The first representative verifies, then transfers to claims research, and the second verifies again. Give the identifiers again without being asked twice; it is the single largest saving on a transferred call.

Ask about claims one at a time and repeat each claim number back. Payer systems key on the claim number, and a misheard digit produces a confident answer about a different claim.

If the representative will not discuss the claim without something the workflow does not disclose, do not improvise. Record what they asked for and end the call. That result is actionable: it tells the billing office exactly what to send next time.

## Bundling

Most payers will discuss several claims on one call, typically two or three, and some will do more for the same member. The expensive part of the call is reaching the representative, so bundling pays the hold once instead of once per claim. Respect the payer's own cap; pushing past it gets the call cut short.

## Denials

Ask for the CARC and any RARC, not just the reason in words. `CO-97` and `PR-204` route differently in a billing system, and the words a representative uses vary.

Ask three follow-ups every time: can it be appealed, by when, and where does the appeal go. Then ask whether a corrected claim is accepted instead. That last question decides whether the practice writes an appeal letter or resubmits, and the answer is frequently different from what the denial letter implies.

Never argue the denial on the call. The agent's job is to bring back what the plan's record says.

## Timing

Payer lines are busiest at the start of the week and over the lunch hour in their own timezone. Early morning in the payer's timezone is usually the shortest queue. Call inside business hours in the payer's timezone, not the practice's.

## Outcomes worth distinguishing

| Outcome | Means | What the practice does next |
| --- | --- | --- |
| `answered` | Every claim on the call got a supported answer | Work the answers |
| `partial` | Some claims answered, some not confirmed | Work what is confirmed, requeue the rest |
| `not_on_file` | The plan never received the claim | Resubmit, do not appeal |
| `rep_refused` | Credentials the workflow does not carry were required | Supply them and call again |
| `ivr_dead_end` | No representative reachable through the menu | Try the portal or a different number |
| `hold_timeout` | Limit reached with nobody on the line | Requeue into a different hour |
| `unreached` | The line did not connect | Retry with backoff |

Collapsing these into "failed" throws away the part that tells a practice what to do next.
