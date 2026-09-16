# Side effects and cancellation

## Preview

Preview creates no network request, telephone call, payment, order, inventory change, or recurring job.

## Simulation

Simulation reads local JSON fixtures only. It creates no telephone call, payment, order, inventory change, or recurring job.

## Live CALL-E

Live mode makes exactly one explicitly requested outbound CALL-E call attempt for the supplied E.164 recipient. It can consume provider credits and ring a real person. There is no automatic retry after an ambiguous submission.

Before submission, stopping the process has no external effect. After CALL-E accepts a request, a call may already be queued or in progress and may not be cancellable. Closing the CLI is not proof that a submitted call stopped.

## Payment

The public `DemoPayment` port is synthetic. It produces a `demo_ready` URL and moves no money. Jalolink/Paystack behavior is outside this repository and is described only as a case study.
