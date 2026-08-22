# Reference implementation

A runnable dashboard for this skill:
https://github.com/nickillig3-dotcom/standby

It shows the cascade unfolding one call at a time, the transcript behind each
outcome, and the four capabilities deliberately withheld from the agent.

## Run it with no CALL-E account

    npm start

Fixture mode replays recorded CALL-E responses. The whole cascade runs — every
state, every transcript, the stop condition — with no credentials, no signup
and no cost. There are no npm dependencies to install.

    CALLE_LIVE=1 npm start

The same code path, against real calls.

## The rules, as tests

    npm test

The ordering, the retry pass, the callback handling, the quiet-hours override,
the cutoff, the late-arrival flag and the one-call-in-flight guard are each
asserted directly against the state machine — no phone, no network, no account.
