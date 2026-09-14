"""LEASH -- a phone call that can only take capability away.

An unattended agent holds a Google OAuth credential on a lease. When the lease
expires the supervisor places one CALL-E call to the account owner, who has exactly
one power: end the lease. Ending it revokes the credential at Google, and the agent
cannot mint another without a human at a browser.

The call cannot grant anything. "continue" is not permission -- it is the absence of
a release, and policy.py requires twelve independent conditions to hold before it is
honoured. "stop" requires one. So does a machine answering, a result that disagrees
with its own transcript, an unreadable result, a call that never reaches terminal, or
this process crashing. Every uncertain path ends the lease.
"""

__all__ = ["templates"]
