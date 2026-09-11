"""
No-Show Guard
=============

A small-business appointment confirmation agent backed by the CALL-E API.

"No-Show Guard" automatically places an outbound AI confirmation call to each
customer ~24 hours before their upcoming appointment. On the call, the agent
confirms identity, reads out appointment details, and captures whether the
customer wants to *Confirm*, *Reschedule*, or *Cancel*.

The structured result returned by CALL-E is parsed and stored in a local
SQLite database, "no answer" outcomes are retried (max 2 retries, 2 hours
apart), and a daily summary report is generated.

Module layout
-------------
- ``config``      : environment loading + shared settings
- ``prompts``     : the configurable agent call script / result schema
- ``call_agent``  : low-level CALL-E HTTP client (create + poll calls)
- ``db``          : SQLite models + persistence helpers
- ``scheduler``   : decides which appointments need a call *today*
- ``report``      : daily summary generation (console + CSV)
- ``cli``         : ``python -m noshow_guard run`` entry point
"""

__version__ = "0.1.0"
__all__ = ["__version__"]
