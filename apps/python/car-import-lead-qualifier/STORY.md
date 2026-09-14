# Car Import Lead Qualifier

**Calls every car-import lead and returns a decision, not a transcript.**

## Inspiration

A vehicle importer in Mozambique collects inquiries all week — a quote form on the site, a
calculator landing page, a partner dealership referral. Every row is a phone number and a
sentence about a car. None of them says whether the person is ready to buy, still
comparing, or already gone.

The only way to find out is to dial. So someone spends a morning on the phone, and out of
$N$ rows perhaps $k$ are worth a specialist's time. The cost of that morning is

$$
C_{\text{manual}} = N \cdot \bar{t}_{\text{call}},
\qquad
\text{yield} = \frac{k}{N},
$$

and $\bar{t}_{\text{call}}$ is paid in full on every row, including the $N-k$ that were
never going to convert. The two good leads look exactly like the rest until someone dials.
The work is unskippable and almost entirely wasted.

That asymmetry is what I wanted to attack: the *qualification* call is mechanical — seven
questions, always the same seven — while the *sales* call is not. Automate the first, and
a human only ever picks up the phone for someone who already said they were ready.

## What it does

It rings people who **already submitted a vehicle import inquiry**, discloses that the
caller is an AI assistant, asks seven qualification questions, and returns a
schema-validated result plus exactly one routing decision per lead: close it, book a human
specialist, route to payment support, nurture, retry later, or stop calling this number.

The default mode is a masked preview that never contacts the provider. Live mode requires
`--execute`, a separate `--confirm-lead-consent`, a server-side API key, and every lead to
carry `submitted_import_inquiry: true` or the file will not even parse. Cold lists are out
of scope by construction.

## How I built it

Python, `uv`, and the CALL-E API, split so that each module has one thing it is allowed to
know:

| Module | Responsibility |
| --- | --- |
| `models.py` | Lead parsing, E.164 and IANA timezone validation |
| `locales.py` | E.164 prefix → market: locale, timezone, calling window |
| `task.py` | The spoken call task for one lead |
| `schema.py` | The `result_schema` for one lead |
| `runner.py` | Preview / execute, idempotency, polling, CLI |
| `routing.py` | The post-call decision, from the structured result only |

Four design decisions carried most of the weight.

**The market comes from the number, not from the CRM.** There is deliberately no `country`
field on a lead; a `country` key added to one is ignored. The E.164 prefix of the number
that will actually be dialled resolves the locale, the timezone, and the local calling
window. A mislabelled row cannot cause a call in the wrong language or at three in the
morning. Prefixes match longest-first, and a number outside every market is rejected at
parse time with a masked error rather than dialled.

**Closed enums, not free text.** Every answer is a small closed set with
`additionalProperties: false`, and the spoken options in `task.py` are read *from* the
schema, so the script and the extraction cannot drift apart. The results stay comparable
across calls and feed a dashboard without parsing.

**Routing reads structure, never a transcript.** `routing.py` evaluates opt-out signals
before any commercial signal, so a wrong-person or declined-disclosure answer suppresses
the number even when the provider reports a clean, completed call. The confidence gate is
a single threshold — below $c_{\min} = 0.8$ the lead goes to `manual_review` and a human
decides before anyone is dialled again.

**Two independent guards against a double call.** Every call carries the idempotency key

$$
\texttt{carimport-}\langle\textit{campaign}\rangle\texttt{-}\langle\textit{lead}\rangle\texttt{-}d,
\qquad
d = \mathrm{SHA\text{-}256}(\textit{phone})_{[0:8]},
$$

so a rerun of the same attempt is deduped by the provider, while *correcting* a mistyped
number changes $d$ and therefore produces a genuinely new call instead of replaying the
call to the wrong number. The digest keeps the number itself out of a value that travels
in headers and logs, and $16^8 = 2^{32}$ is ample: a collision would additionally have to
land on the same campaign *and* the same `lead_id`. Second, a state file records each
lead's attempt count and route after every decision, written through an atomic replace at
mode `0600`, so an interrupted batch resumes instead of redialling.

The attempt ladder is bounded. With $A_{\max} = 3$, the number of calls to any one number
satisfies $a \le A_{\max}$; once the budget is spent the lead comes back `exhausted` with
a `manual_review` decision rather than being dialled forever.

Calling windows are narrow on purpose: weekdays, 08:00–18:00 local for Mozambique, so the
callable fraction of a week is only

$$
\frac{5 \times 10}{7 \times 24} = \frac{50}{168} \approx 29.8\%.
$$

Leads outside their window are deferred, not dialled, and the result records the next
local window.

51 tests run against a fake CALL-E client, so the suite never places a phone call.

## Challenges

**Two defects were invisible in every dry run.** They only appeared when a real person
answered in their own words.

The first was a compound question. `task.py` asked "Is that still what you want, and what
type of vehicle is it?" — the person confirmed the vehicle, and `vehicle_type` came back
`unknown` on an otherwise complete call. The `evidence` line never mentioned a vehicle
type at all, because the type was never actually collected. The question is now split in
two, and the schema states that confirming the inquiry vehicle is not by itself a type.

The second was arithmetic. A caller reported USD 20,000, sitting exactly on the border
between `10k_20k` and `over_20k`, and the spoken script offered "ten to twenty thousand,
or more than twenty thousand" — ambiguous at the boundary in *both* directions. The fix
was to make the bands half-open and say so out loud:

$$
b_i = [\ell_i,\ \ell_{i+1}), \qquad \ell = (0,\ 5\text{k},\ 10\text{k},\ 20\text{k},\ \infty),
$$

with the spoken options rewritten to "ten up to twenty thousand, or twenty thousand or
more."

**Confidence is not a liveness signal.** Two attempts on a test line were declined by the
provider before any media existed — zero duration, no ringing, connected, audio, or ASR
events — and *both still returned* `completion_confidence` of $0.66$ and $0.62$, labelled
`medium`. Nothing was said on either call. Routing already read `provider_status` and
`task_completed` first and used the score only for the `manual_review` gate, which turned
out to be the right order by luck as much as design. Anyone tempted to route on $c$ alone
should read those two rows first. I reported this upstream; the provider's own
investigation confirmed no media existed, which makes a `medium` score on those calls
harder to explain, not easier. It remains open.

**A provider "decline" is two different events.** CALL-E maps a failed ByCallee result to
`DECLINED` even when the destination never actively declined, because media was never
established. So a decline cannot be treated as an opt-out — it is retryable, bounded by
$A_{\max}$ — while a refusal *spoken on the call* still suppresses the number immediately.
The label had to be decided against rather than trusted.

## What I learned

**Ship the market you have actually dialled.** Angola, Tanzania, and Kenya were in
`MARKETS` and were never called once. I removed them rather than leave them in untested:
each would need a real port list it can quote and a real call placed to verify it. The
`destination_port` enum now matches the only market served.

**Live calls are the only test for a spoken script.** Both defects above passed 51 tests.
Seven live executions across four leads exercised five of the seven routes — including the
revenue route and the opt-out route — and one of them corrected the delivery port from the
one on file to Nacala. That correction mattered more to me than the conversion: it means
the script was understood well enough to be *argued with*, and the structured result
carries the fix instead of the stale CRM value.

**Recording a clean "no thanks" is as valuable as recording a yes.** A qualification
workflow that cannot cleanly close a lead is a workflow that will keep calling people.

## Still untested, honestly

`payment_support` — the route that motivated the whole design, since a blocked payment
here is usually a delayed sale rather than a lost one — has never fired on real speech.
The sub-$0.8$ confidence gate has never fired live either. And no *human* has yet refused:
the opt-out path was proved against an automated hotline agent, not against a person
saying no. The routing is identical either way, but that recording does not exist yet, and
it is the most valuable gap left.

Every run, both defects, and every remaining gap are written up in `docs/field-notes.md`.
