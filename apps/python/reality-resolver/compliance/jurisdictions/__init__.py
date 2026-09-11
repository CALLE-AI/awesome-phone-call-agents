"""One module per jurisdiction. Each module exposes:

- RULES: a compliance.models.JurisdictionRules describing the jurisdiction
- check(context) -> list[CheckResult]: the actual pre-call checks

Adding a new jurisdiction means adding a new module here that follows this
shape, then registering it in compliance/dispatcher.py's _MODULES table and
_COUNTRY_CODE_CHAINS table. No other file needs to change.
"""
