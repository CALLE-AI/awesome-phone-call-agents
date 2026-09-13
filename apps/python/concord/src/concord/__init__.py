"""Concord audits what a branch tells a caller, and judges the answer against policy.

The package is deliberately split so that the half which gathers speech cannot
rule on it, and the half which rules cannot dial. See skill/references/safety.md.
"""

__version__ = "0.1.0"
