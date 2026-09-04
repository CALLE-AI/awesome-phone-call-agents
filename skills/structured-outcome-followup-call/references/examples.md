# Examples

This skill is mock-only. The examples run locally with the Python standard
library, use a standards-reserved fictional phone number, and place no calls.

## Run the worked example

```bash
python3 scripts/orchestrate_example.py
```

The script runs deterministic delivery-exception scenarios and prints the
structured outcome. Failed and unanswered scenarios stop before rubric scoring.

## Run the regression tests

```bash
python3 scripts/test_orchestrate_example.py
```

The tests exercise completed, failed, and unanswered outcomes without network
access or credentials.
