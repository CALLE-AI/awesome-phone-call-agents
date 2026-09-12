## Muster — directory ghost-rate auditor

Muster audits a directory an institution *claims* is valid (an insurer in-network provider list, a marketplace's "verified" sellers) by calling every listing through CALL-E, asking one benign verification question, and labeling each entry PRESENT, GHOST, UNREACHABLE, or UNCERTAIN with a cited transcript quote, a confidence score, and a headline ghost-rate.

CALL-E is called at runtime via the CLI (`calle call start` / `calle call status`). The skill also exposes a FastMCP tool and a web audit ledger.

- Skill: `skills/muster/`
- Full project (engine, classifier, tests, web UI): https://github.com/omshukla24/Muster

Verified end to end with a real English call (PRESENT verdict with transcript). Mock mode runs the full pipeline with zero credits for development and demos.
