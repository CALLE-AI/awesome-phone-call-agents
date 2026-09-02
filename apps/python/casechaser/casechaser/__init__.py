"""CaseChaser: chase an open case (claim, refund, repair, delivery, complaint) to closure by phone.

Every call is planned from the case ledger, executed through CALL-E, and turned into a dated,
quoted commitment record. Broken commitments escalate on a fixed ladder; money and legal
decisions always stop at a human.
"""

__version__ = "0.1.0"
