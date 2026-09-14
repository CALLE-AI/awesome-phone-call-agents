# Afterword demo

**Hosted:** https://afterword-95953931159.us-central1.run.app

One estate, six fictional institutions, all five grades. No credentials, no
calls.

```bash
cd apps/python/afterword
python3 -m afterword.cli demo
```

| Institution | Grade | What it shows |
| --- | --- | --- |
| Northgate Building Society | `REQUIREMENTS_CAPTURED` | The good case: department, two documents, a certified copy accepted, the account frozen, a reference to quote. |
| Hartsmere Pension Trust | `DISPUTED` | Contradicts an earlier call to the same institution, on both the documents and the certified copy. |
| Calderwell Mutual Assurance | `DISPUTED` | Contradicts the institution's own recorded policy. |
| Brightpath Energy | `PARTIAL` | A person answered, but the direct-debit question was never answered. |
| Larkspur Mobile | `REFERRED` | Will only speak to the executor. A correct refusal, reported plainly. |
| Fenwick Vale District Council | `UNREACHED` | An IVR dead end. Council tax press one, bins press two. |

The pack ends with four disputes recorded and five of six still needing a
person. That ratio is the honest one, and it is the point: a family gets one
finished section and a clear list of what still needs them.

## The disputes are the interesting part

```bash
python3 -m afterword.cli demo inst-02
python3 -m afterword.cli demo inst-03
```

Afterword records **both sides** and picks no winner. Quietly choosing one is
how a family posts an original death certificate that then goes missing.

Document requirements are compared as sets in both directions, because
under-sending and over-sending are both dangerous.

## What it will not do

```bash
python3 -m afterword.cli plan inst-01
```

Prints the whole spoken script. Two things to look for: it asks what is
required rather than asserting the death as established fact, and **the
telephone number is not in it**. The number travels in the request's
`recipients` field, so a preview can show the entire script without disclosing
the line.

`closes_account` and `accepts_terms` are `False` on every result, in every
scenario, and property tests sweep them.

## Console

```bash
python3 -m afterword.api        # http://localhost:8080
```

The pack is the hero: a printed document rather than a dashboard, with a print
stylesheet, and a closing section for everything that still needs a person.
