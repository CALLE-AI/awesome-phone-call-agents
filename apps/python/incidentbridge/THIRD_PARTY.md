# Third-party reuse boundary

| Upstream | License | Reused | IncidentBridge increment |
|---|---|---|---|
| [CALL-E `calle-ai`](https://pypi.org/project/calle-ai/) | MIT | Official server SDK, call creation, polling, structured results | Vendor-incident task, strict schema, fail-closed incident route, durable reservation |
| [CALL-E integrations](https://github.com/CALLE-AI/call-e-integrations) | MIT | SDK/API contract and safety flow | Focused incident-support workflow and audit output |
| [FreshChain Resolver](https://github.com/CALLE-AI/awesome-phone-call-agents/tree/main/apps/python/freshchain-resolver) | MIT | Preview/live separation, loopback SDK test pattern, endpoint allowlist pattern | Different incident domain, input contract, result schema, decision boundary, CLI and tests |
| DataOpsPilot (local project) | MIT | Failure-taxonomy and human recovery-verification boundary | Real phone execution and vendor evidence collection |

No upstream model weights, credentials, phone numbers, call recordings, or transcripts are
redistributed.
