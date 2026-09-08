"""Known Number: callback verification for vendor payment-detail changes over CALL-E.

The principle is the one every fraud advisory repeats and most accounts-payable
teams skip because it is tedious: when a supplier asks you to pay a different
bank account, call the number you already had on file for that supplier, never
the number in the request, and confirm the change out of band.

This package turns that control into a deterministic, auditable workflow:

* the request is parsed and gated by policy before anything is dialed,
* the call is planned so that it carries no secret (the vendor reads the new
  details back; the caller never reveals them),
* CALL-E extracts a schema-validated result from the conversation,
* a local, deterministic reconciliation produces one of five verdicts and
  refuses to say CONFIRMED on partial evidence.
"""

__all__ = ["__version__"]
__version__ = "0.1.0"
