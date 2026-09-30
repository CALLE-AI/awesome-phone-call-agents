# Simulator Host Twilio Webhooks

The simulator host is a dedicated non-production process. Phase 3 provider callbacks remain separate from the Phase 4 browser REST lifecycle documented in `simulator-host-live-runs.md`.

`docs/api/openapi.yaml` remains the production API and generated-client contract. It deliberately excludes simulator-host and provider composition, so these non-production callbacks are documented and validated separately here rather than added to the production client surface.

## `POST /twilio/voice`

- Content type: `application/x-www-form-urlencoded`
- Authentication: Twilio `X-Twilio-Signature` over the canonical configured public URL
- Trace propagation: optional W3C `traceparent` and `tracestate`
- Correlation: before the first bind, the host requires a valid Twilio signature and the exact authorized target digest. It then atomically learns the presented caller digest and binds it with the Twilio `CallSid` to the sole exact-target reservation whose one provider dispatch was already durably claimed. A different caller, target, or SID after binding receives the safe reject/error response. Same-SID semantic redelivery returns the same TwiML without reserving or dispatching again. No permit, signing token, phone value, or credential appears in the URL or TwiML.
- Response: bounded `application/xml` TwiML or an empty safe error response

## `POST /twilio/canary/{callbackHandle}`

- `callbackHandle` is the durable opaque operation handle returned by the initial callback binding.
- The callback requires the same bound `CallSid`, a valid `X-Twilio-Signature`, and `application/x-www-form-urlencoded` content.
- Any observed DTMF hangs up and activates the shared process-lifetime safety stop. The digit value is never retained or logged.
- The Gather uses empty-result delivery; an absent `Digits` field is admitted as zero actions. The document ends with Hangup, independently bounding the provider leg.

## `POST /twilio/status`

- Authentication: Twilio `X-Twilio-Signature` over the exact configured public origin plus `/twilio/status`; inbound `Host` and forwarding headers are never signature authority.
- The form is bounded and accepts only the already-bound `CallSid`, authorized caller/target identities, a closed status disposition, and a duration no longer than 60 seconds.
- Invalid signatures receive an empty `403`. A different signed `CallSid` fails closed. Genuine same-SID redelivery is semantically idempotent even when retry time or trace context differs, preserving the first durable fact.
- Response: empty `204` only after the status fact is durable.

## Placeholder-only local configuration

These names document the contract without committing credentials or phone values:

```text
RUNTIME_PROFILE=<placeholder>
SIMULATOR_HOST_ENABLED=<placeholder>
SIMULATOR_PUBLIC_BASE_URL=<placeholder>
SIMULATOR_ENDPOINT_ALIAS=<placeholder>
SIMULATOR_TARGET_ALLOWLIST_JSON=<placeholder>
SIMULATOR_KILL_SWITCH_FILE=<placeholder>
SIMULATOR_AUTHORIZATION_AUDIENCE=<placeholder>
SIMULATOR_AUTHORIZATION_SIGNING_KEY_FILE=<runtime-secret-file-reference>
SIMULATOR_CALLBACK_IDENTITY_HMAC_KEY_FILE=<runtime-secret-file-reference>
SIMULATOR_CALL_BUDGET=<placeholder>
SIMULATOR_CONCURRENCY=<placeholder>
SIMULATOR_PROVIDER_TIMEOUT_MS=<placeholder>
SIMULATOR_CUSTODY_ROOT=<placeholder>
SIMULATOR_CUSTODY_MAX_TRANSCRIPT_BYTES=<placeholder>
SIMULATOR_CUSTODY_MAX_ENTRIES=<placeholder>
SIMULATOR_JOBS_SCHEMA=<placeholder>
SIMULATOR_ORGANIZATION_ID=<placeholder>
SIMULATOR_LISTEN_HOST=<placeholder>
SIMULATOR_LISTEN_PORT=<placeholder>
DATABASE_URL=<placeholder>
CALLE_API_KEY_FILE=<runtime-secret-file-reference>
CALLE_API_ORIGIN=https://api.heycall-e.com
TWILIO_AUTH_TOKEN_FILE=<runtime-secret-file-reference>
TWILIO_ACCOUNT_SID_FILE=<runtime-secret-file-reference>
TWILIO_NUMBER_SID_FILE=<runtime-secret-file-reference>
SIMULATOR_RUN_GATE_FILE=<absolute-path; resting content CLOSED followed by newline>
NGROK_CAPTURE_ATTESTATION_FILE=<reviewed-local-json-path>
```

The host fails closed unless the runtime is non-production, the alias resolves to exactly one allowlisted target, the custody root is absolute, the signing keys are strong, the run gate initially contains exactly `CLOSED` followed by a newline, the no-callback deadline is at most 120 seconds, the separate provider-terminal watchdog is at most 180 seconds, and the kill-switch file contains exactly `ALLOW` followed by a newline. Browser polling guidance remains independently bounded to its initial 60-second window.
