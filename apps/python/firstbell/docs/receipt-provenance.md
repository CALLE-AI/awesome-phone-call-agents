# A receipt that cannot claim a call it did not place

An app that places phone calls writes its own evidence. That is a conflict of interest, and
it is invisible: a receipt saying `mode: live` next to a real-looking call id is
indistinguishable from a receipt describing a run that dialled a local double, or one that
replayed a call placed last week and charged nobody.

This matters more than it looks. A receipt is the artefact a reviewer, an auditor or a
school office reads instead of watching the run. If it can overstate what happened, every
number computed from it is unsupported.

Four rules make a receipt unable to lie about its own origin. Each one is broken on purpose
in [`../evidence/MUTATIONS.md`](../evidence/MUTATIONS.md).

## 1. Do not let one field carry both the intention and the outcome

Not "a base URL was configured". Not "the live flag was passed". The receipt says `live`
only when the host actually dialled was the production API.

```python
@property
def reached_production(self) -> bool:
    if not self.live or not self.base_url:
        return False
    return (urlparse(self.base_url).hostname or "") == PRODUCTION_HOST
```

**Compare hostnames, never substrings.** A substring test passes
`api.heycall-e.com.example.net`, which is a domain an attacker or a misconfigured proxy can
own. It also passes every honest test you would think to write, because honest tests use
the real hostname. Mutation 4 replaces the comparison with a substring test; two tests
catch it, and both exist only because the mutation was tried.

The third state matters too. A run that was live but reached somewhere else is neither
`offline` nor `live`; it is `live-nonproduction`, and collapsing it into either one is the
lie.

## 2. Record the address next to the claim

`api_base_url` and `reached_production_api` sit in the receipt beside `mode`. A reader does
not have to trust the label, because the input to the label is printed next to it.

## 3. Say, per item, whether this run placed the call

A run that replays idempotency keys returns the original calls. Those are real calls with
real ids, and none of them happened just now. Without a per-item marker, a replayed receipt
looks exactly like a fresh one.

Each item carries `placed_by_this_run` as **true, false, or null**, and the summary counts
all three separately: placed, replayed, and unknown provenance. The receipt for the replay
run reads `calls placed 0, calls replayed 2`. No phone rang and the account was not charged,
which the vendor's usage page confirms independently of our log. That receipt file is in
neither this tree nor on the [evidence page](https://firstbell-evidence.vercel.app), for the
reason [`../evidence/README.md`](../evidence/README.md) gives. What is committed is the count
it produced: [`../evidence/recorded-calls.json`](../evidence/recorded-calls.json) records
`02-idempotent-replay-no-calls.json` as two calls with none of them placed by that run.

## 4. Answer "unknown" rather than guessing

```python
if started is None or not raw:
    return None
...
if created > started + timedelta(hours=1):
    return None
return created >= started - timedelta(seconds=1)
```

Two cases return `None` instead of a boolean. A response with no usable `created_at`
cannot support either answer. A `created_at` implausibly far in the future means a clock
disagrees somewhere, and treating a skewed clock as evidence of a fresh call is how a
replay gets published as a live run.

Mutations 12 and 13 remove exactly these two, and each is caught by one test. The rule is
the same one that governs outcome classification elsewhere in this app: a gate needs a
third outcome, and "could not measure" must not fold into either of the other two.

## 5. Carry the id the vendor bills against

The API returns `id`, a `call_` prefix followed by twenty-two characters of base64url.
CALL-E's dashboard and its usage page are keyed on a different value, a bare
thirty-two-character lowercase hex string at `recipients[].attempts[].provider_call_id`.
The two never appear together outside the raw response, and this app dropped the second one
for its first twelve commits.

Both are described here rather than shown. A real one of either is a handle to a real
conversation, and this repository commits neither: see `tests/test_privacy.py`, which fails
if one appears. The second format is the reason that check looks for more than a `call_`
prefix, because a bare hex string looks like nothing in particular and a scrub aimed at the
obvious pattern goes straight past it.

That omission is the whole problem in miniature. Rules 1 to 4 make a receipt internally
honest, and internal honesty is still a run marking its own work. `provider_call_id` is the
join to the one account of a call nobody here writes: the vendor's billing record. With it,
a reader takes a row from this app's output, finds it on CALL-E's usage page, and sees the
charge, the duration and the hang-up type from a source with no stake in our claims.

It is read from the **last** attempt, not the first. A call that fell back to a second
number was billed under the attempt that connected, so citing the first attempt would print
an id for a call that never happened. Mutation 14 makes exactly that change and one test
catches it.

## What it costs

Four fields and about forty lines. In exchange, every number this app publishes can be
traced to a run whose target host, freshness and billing status are all on the record. In a
repository where dozens of contributions commit real call ids, none of that is visible from
a call id alone.
