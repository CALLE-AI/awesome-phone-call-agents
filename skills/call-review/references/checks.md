# Checks and thresholds

Matches `apps/web/call-review-console/crc/`.

| Check | Rule | Effect |
|---|---|---|
| Failed call | `status != completed` or `attempts[].failure_code` set | reject |
| Schema | `structured_result` invalid against `metadata.result_schema` | reject |
| Unsupported field | numeric value not spoken, or < 60 % of value tokens (len > 2) present in the transcript after folding "9 a.m." → "9am" | reject |
| Enum/boolean field | `yes/no/true/false/unknown/none` | unknown, needs reading (optional Gemini pass cites the turn) |
| AI disclosure | agent turn matching `(I am|I'm|this is) (an?|the)? (AI|automated|virtual|artificial) (assistant|agent|system|caller|intelligence)` or "calling on behalf of … AI" | missing → reject |
| Stop request | callee turn matching `stop calling|don't call|do not call|remove (me|my number)|take me off|unsubscribe|not interested, stop` | any later agent turn that is not a goodbye → reject |
| Sensitive readback | agent turn containing 13–19 digit sequences or `card|cvv|ssn|social security|passport` followed by digits | reject |
| Response latency | agent `offset_seconds` − previous callee `offset_seconds`, positive values only | p95 > 6 s → needs_human |
| Overlaps | a turn whose offset is below the previous turn's offset | ≥ 2 → needs_human |
| Silence | gap between consecutive turns > 4 s | listed; no verdict effect |
| Agent talk share | agent turns ÷ all turns | informational |
