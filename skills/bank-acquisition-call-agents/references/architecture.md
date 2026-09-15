# Architecture Reference

## Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│                 Bank Acquisition Platform                     │
│                                                              │
│  ┌─────────────┐                                             │
│  │ Lead Profile │──scoreLead()──► conversionProbability ≥ 70 │
│  └─────────────┘                        │                    │
│                                         ▼                    │
│              ┌──────────────────────────────────────┐        │
│              │   Agent 1: Lead Outreach              │        │
│              │   POST /api/calls/outreach             │        │
│              │   CALL-E goal: introduce bank,         │        │
│              │   qualify intent, capture callback     │        │
│              └────────────────┬─────────────────────┘        │
│                               │ intent = "interested"         │
│                               ▼                              │
│  ┌────────────────┐   ┌──────────────────────────────────┐   │
│  │ Offer Engine   │──►│  Agent 2: Offer Explanation       │   │
│  │ (scored bundles│   │  POST /api/calls/offer-explain    │   │
│  │  top 3 offers) │   │  CALL-E goal: walk through offers,│   │
│  └────────────────┘   │  handle objections, verbal consent│   │
│                        └─────────────────┬────────────────┘   │
│                                          │ consent = true     │
│                                          ▼                    │
│  ┌──────────────────┐  ┌─────────────────────────────────┐   │
│  │ KYC Studio       │  │  Agent 3: Customer Support       │   │
│  │ (onboarding flow)│  │  POST /api/calls/support-inbound │   │
│  └──────────────────┘  │  CALL-E goal: answer KYC queries,│   │
│                        │  explain declined offers,         │   │
│                        │  escalate if unresolved           │   │
│                        └─────────────────────────────────┘   │
│                                                              │
│  All three agents write ──► AuditRecord[] (lib/auditLog.ts)  │
└──────────────────────────────────────────────────────────────┘
                │               │               │
                ▼               ▼               ▼
          CALL-E CLI      CALL-E API      CALL-E MCP
          plan_call       run_call        get_call_run
```

## Key Files

| File | Role |
|------|------|
| `lib/calleClient.ts` | CALL-E CLI wrapper — `planCall`, `runCall`, `startCall`, `getCallStatus` |
| `lib/callScriptEngine.ts` | Renders multilingual CALL-E goal strings from live data |
| `app/api/calls/outreach/route.ts` | Agent 1 API endpoint |
| `app/api/calls/offer-explain/route.ts` | Agent 2 API endpoint |
| `app/api/calls/support-inbound/route.ts` | Agent 3 API endpoint |
| `app/api/calls/call-status/route.ts` | Live status poll |
| `app/call-center/page.tsx` | Operator dashboard UI |
| `lib/bankRegistry.ts` | Bank config map (name, theme, locale) |
| `data/productBundles.ts` | Offer bundles with `{bank}` token |
| `lib/governance.ts` | Audit records, governance flags |

## CALL-E Integration Mode

Integration: **CLI** (`CALLE_INTEGRATION=skills_sh_skill`)

The `startCall()` helper wraps `calle call start --json`, which calls
`plan_call` followed by `run_call` in a single command and returns
the run record. The `getCallStatus()` helper wraps `calle call status --json`.

All CALL-E env vars are set in `lib/calleClient.ts`:
```typescript
const CALLE_ENV = {
  CALLE_SOURCE: "skills_sh",
  CALLE_INTEGRATION: "skills_sh_skill",
  CALLE_INTEGRATION_VERSION: "0.1.0",
};
```
