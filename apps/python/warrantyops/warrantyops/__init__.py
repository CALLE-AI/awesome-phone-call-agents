"""Reusable scaffold for turning one authorized phone call into a verified outcome.

The modules in this package are deliberately domain-independent. Only
:mod:`warrantyops.contract` knows what a warranty is; everything else operates
on the contract it publishes, so the same machinery survives a change of
domain.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
