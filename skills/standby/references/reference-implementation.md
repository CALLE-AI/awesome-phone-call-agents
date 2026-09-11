# Reference implementation

A runnable dashboard for this skill:
https://github.com/nickillig3-dotcom/standby

It shows the cascade unfolding one call at a time, the transcript behind each
outcome, the hold when an answer cannot be read, and the four capabilities
deliberately withheld from the agent.

## Run it with no CALL-E account

    npm start

Fixture mode replays five authored CALL-E responses. The whole cascade runs —
every state, every transcript, the stop condition and the hold — with no
credentials, no signup and no cost. There are no npm dependencies to install.

The fixtures are **written, not recorded**: `scripts/make-fixtures.mjs` produces
them and `npm test` re-runs it in `--check` mode, so they are provably that
generator's output rather than a capture of somebody's phone call.

Pick the `unreadable-call` scenario to watch the cascade stop on a call it
cannot read and wait for a person.

    CALLE_LIVE=1 npm start

The same code path, against real calls.

## The rules, as tests

    npm test

The ordering, the retry pass, the callback handling, the quiet-hours override,
the cutoff, the late-arrival flag, the one-call-in-flight guard and the
human-reconciliation hold are each asserted directly against the state machine —
no phone, no network, no account. It also scans every file in the repository for
a phone number outside a permanently withheld range.
