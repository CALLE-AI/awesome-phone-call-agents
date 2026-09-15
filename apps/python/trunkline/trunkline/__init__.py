"""Trunkline: call the health plan, wait on hold, bring back a structured answer.

Trunkline is a runnable demo app on the CALL-E Developer API. It calls a payer's
provider-services line on behalf of a medical practice, navigates the phone menu,
waits on hold, speaks with the representative, and returns an evidence-bound,
schema-checked answer a biller can act on.

It gathers and structures. It never files an appeal, never agrees to anything,
and never writes anywhere without a person approving first.
"""

__version__ = "0.1.0"
