# The result contract

The Goal's `result_schema` is the whole product. Everything else is transport.

## `input_schema` — scalars only

CALL-E Goal inputs are per-run scalar business values. No nested objects, no arrays, no
nulls.

| Field | Type | Example |
|---|---|---|
| `office_name` | string | `Kantor Imigrasi Jakarta Selatan` |
| `procedure` | string | `perpanjangan paspor` |
| `city` | string | `Jakarta Selatan` |

Do not send `target`, `region`, `locale`, or `display_name` per run. Voice region and callee
locale belong to the published Goal and cannot be changed per run.

**Never send personal data.** No name, identity number, or case reference. The clerk is
being asked a general question about a procedure, and does not need to know who is asking.

## `result_schema` — `additionalProperties: false`

| Field | Type | Values |
|---|---|---|
| `required_documents_text` | string | newline-separated, in the clerk's terms, not normalised |
| `total_fee_idr` | number, **optional** | absent when the clerk did not know |
| `payment_method` | enum | `cash` · `card` · `both` · `unknown` |
| `appointment_required` | enum | `yes` · `no` · `unknown` |
| `originals_or_copies` | enum | `originals` · `copies` · `both` · `unknown` |
| `clerk_certainty` | enum | `confident` · `unsure` · `refused` |
| `clerk_quote` | string | one verbatim supporting line |

### Why `additionalProperties: false` matters

It is the difference between parsing and validating. With it, a result that arrives shaped
differently is a **detectable** failure that routes to `result_invalid` and renders nothing.
Without it, an unexpected shape is silently accepted and a wrong checklist reaches someone
about to travel.

### Why every enum has an `unknown`

Because clerks say "I am not sure", and that has to be representable. An enum without
`unknown` forces the extraction to pick a value it did not hear, which is exactly the
failure this skill is built to avoid.

`total_fee_idr` is **optional** for the same reason. A missing fee is an absent key, never
`0` and never a typical value.

### Why the document list is a string

A Goal Run `result` is a flat map of scalars. From the CALL-E OpenAPI spec:

```yaml
result:
  type: [object, "null"]
  additionalProperties:
    $ref: "#/components/schemas/GoalScalar"   # string | number | boolean
```

No arrays, no nested objects, no nulls. This is a Goals-API constraint specifically — the
one-shot Calls API does accept `simple array.items` in its request-scoped `result_schema`,
but Goals does not, and Goals is what provides the published, reusable procedure catalogue.

So the checklist travels as a newline-separated string and is decoded client-side by
`decodeDocuments`. The same constraint is why `total_fee_idr` is optional rather than
nullable: `null` is not a `GoalScalar`, but an absent key costs nothing and means exactly
what `null` meant.

### Why `clerk_certainty` is our field, not the platform's

An earlier design expected a `completion_confidence` signal on the Goal Run resource. That
field belongs to the **Calls** API `CallTask`; a Goal Run exposes only
`{id, goalId, runId, runSpec, status, result, error, createdAt, completedAt}`.

Modelling certainty inside our own `result_schema` turned out to be strictly better. It is
our contract rather than a platform signal we hoped existed, it is pinned and versioned with
the rest of the schema, and it distinguishes `refused` from `unsure`, which a numeric
confidence score cannot.

### Why `clerk_quote` is required

It is span grounding. The checklist is a claim; the quote is the evidence for it. A user who
distrusts a row can read what the clerk actually said, and a maintainer debugging a bad
extraction can see whether the model misheard or the clerk was genuinely ambiguous.

The quote must support the fields it is attached to. A quote about photocopies does not
justify an `appointment_required` value.

## Contract drift

The pinned contract records the `published_run_spec` version and schema shape this skill was
written against. Before every run, `goals.get` reads the live interface and the two are
compared. Any difference in version or field shape refuses the dial.

This costs one API call per run and is the single highest-value check in the skill: a
drifted schema does not throw, it silently produces confident-looking results that are
wrong.
