# Muster — Examples

## Mock audit (no calls, no credits)

```bash
python skills/muster/scripts/run_audit.py sample_data/us_insurer_network.json --mode mock
```

Runs the full pipeline against a sample insurer directory using deterministic simulated calls. Use it for development and demos.

## Live audit (real CALL-E calls)

```bash
python skills/muster/scripts/run_audit.py sample_data/us_insurer_network.json --mode live --confirm-live
```

Places a real CALL-E call to each listing, asks one benign verification question, and classifies each entry as PRESENT, GHOST, UNREACHABLE, or UNCERTAIN with a confidence score.

## Sample verdict (one listing)

```
Summit Psychological Associates   GHOST   HIGH · 0.95
  "We left that insurance network last year."
```

## Headline stat

```
7 of 12 audited = GHOST (58%)
A patient must call ~2.4 listings to reach one real provider.
```

## Reports

Every run writes a CSV, a JSON package, and a Markdown audit certificate, each carrying the cited transcript evidence per listing.
