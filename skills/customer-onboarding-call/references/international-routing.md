# International Routing

Onboarding calls often target a region the call provider does not serve directly, or serves
unreliably. This reference covers the forwarding pattern, how to diagnose a failing corridor, and
the failure modes that waste the most time.

All numbers below are fictional.

## The forwarding pattern

When a provider will not dial the destination region, place the call to a number in a region it
does serve and forward that leg to the real destination.

```text
provider ──dials──▶ +1-555-0100 (supported region) ──forward──▶ +99-900-000-0001 (destination)
```

Most telephony platforms express the forward as a short instruction on the inbound call, for
example a `Dial` verb naming the destination and using your own platform number as the caller id.
The caller id must be a number you own or have verified; you cannot present the customer's own
number or an arbitrary third-party number.

Keep the ring timeout long enough for an international leg to set up and for a person to reach the
handset, and short enough that the agent is not left talking into a dead line. Twenty to forty
seconds is a reasonable band.

## Do not invert the product

It is tempting, when the forward leg misbehaves, to switch to a conference bridge that both the
agent and the customer dial into.

Do not do this for an onboarding workflow. The premise of the workflow is that the business calls
the customer. A bridge requires the customer to place an international call and wait in silence for
the agent to arrive, which:

- inverts the product being built and demonstrated
- charges the customer for the business's outreach
- fails whenever the customer hangs up during the silent wait

A bridge is a legitimate fallback for a live debugging session between two consenting operators. It
is not an onboarding call.

## Diagnosing a failing corridor

Distinguish these three, because they look similar in a dashboard and have opposite fixes.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Agent transcript contains carrier speech such as "all circuits are busy" | Congestion on the destination corridor | Retry later |
| Platform logs the forward leg as *no answer* with zero duration | Nobody picked up | Retry in the recipient's working hours |
| Provider rejects the destination before dialing | Region not supported by the provider | Use the forwarding pattern, or change provider |

Two rules that prevent most misdiagnosis:

**Do not conclude from a single attempt.** A corridor that fails once and succeeds two minutes
later is congested, not blocked. Confirm with at least three attempts spread across different
hours before declaring a corridor unusable and re-architecting around it.

**Do not test outside the recipient's waking hours.** An overnight attempt that logs *no answer*
tells you nothing about reachability. This is the single most expensive diagnostic mistake in this
workflow, because it looks like hard evidence and points at the wrong layer of the stack.

Check the platform's own geographic permissions before assuming a carrier problem. Many platforms
disable higher-risk destinations by default, and some expose a per-number permission check that
answers the question directly.

## Carrier audio is transcribed as customer speech

When the forward leg fails, the agent hears the carrier's recorded message and the transcript
attributes it to the customer:

```text
0s  agent     Hi, this is an onboarding call from Example Company.
4s  customer  All circuits are busy now. Please try again later.
```

Consequences to design around:

- Do not treat any transcript containing carrier phrases as a real conversation.
- Rely on the presence of a structured result, not on turn count, to decide a human was reached.
- Suppress hold music and connection beeps on any intermediate leg. Anything audible before the
  customer answers may be transcribed and can corrupt extraction.

## The agent starts talking before the customer answers

With a forwarded call the platform typically answers the inbound leg immediately, so the agent
begins its greeting while the destination is still ringing. The customer answers mid-sentence and
misses the introduction.

Mitigations, in order of preference:

1. Have the agent open with a short greeting and a pause, then re-introduce after the first
   response, so a customer who joins late still hears who is calling.
2. Delay the agent's first utterance until speech is detected, when the provider supports it.
3. Accept it, and make sure the agent re-identifies itself if the customer opens with "hello?".

## Providers can report failure and dial anyway

A degraded provider control plane may mark a call failed and place it minutes later. Symptoms:
elevated API latency, a failure recorded with no dial timestamp, and a matching charge or platform
log entry appearing afterwards.

Design for it:

- Make webhook ingestion idempotent, keyed on the provider event or call id.
- Reconcile against provider billing or platform call logs before concluding a call never happened.
- Do not retry immediately on a reported failure during an incident; a delayed original can arrive
  while the retry is in flight and call the customer twice.

## Cost note

Verify whether the provider charges per call or per minute before designing retries. Flat per-call
pricing makes an aggressive retry policy cheap; per-minute pricing makes an agent waiting in
silence expensive. Also budget the forwarding platform's own leg, which is billed separately from
the provider's.
