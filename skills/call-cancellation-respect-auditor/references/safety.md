# Safety & Compliance

1. **Advisory-only scope**: This skill is an offline, heuristic, post-hoc
   transcript auditor. It is not legal advice, not a regulatory finding,
   and not a compliance certification.
2. **Human review required**: Every verdict is a heuristic label for a human
   reviewer. RETENTION_DARK_PATTERN routes to "halt deployment" as a review
   action - a human decides, never the script.
3. **`task_continued` is informational**: The flag records that the agent
   resumed task language after a cancellation request; it does not by itself
   gate the verdict.
4. **Fictional numbers only**: All demonstration and test numbers come from
   the reserved NANP 555-01XX range (e.g. +14155550169). The craft mode
   rejects any number outside that reserved pattern (exit 2).
5. **No auto-actions on real accounts**: The skill takes no action on any
   account, subscription, or call. It reads a JSON file and prints a JSON
   report; nothing else.
