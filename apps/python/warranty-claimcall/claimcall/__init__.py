"""ClaimCall: an evidence-to-authorized-claim-call compiler and reconciler for CALL-E.

Dry-run first. The only command that can cause a phone to ring is
`claimcall run --live`, and it needs an API key, an explicit enable flag, an
allowlisted destination and a matching plan hash before it will.
"""

__version__ = "0.1.0"

from . import dispatcher, manifest, reconcile, safety, schemas

__all__ = ["dispatcher", "manifest", "reconcile", "safety", "schemas"]
