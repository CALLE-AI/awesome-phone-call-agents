# Architecture

## Preliminary architecture

```text
React client
    ↓
Secure Node.js backend
    ↓
CALL-E SDK or API
    ↓
Real outbound phone call
    ↓
Adaptive voice conversation
    ↓
Structured CALL-E result
    ↓
Backend validation and transformation
    ↓
React result dashboard
```

## Current foundation

The frontend is a Vite React and TypeScript application in `client/`, organized into pages, reusable components, services, styles, and types. The exact backend framework and CALL-E integration method are pending verification.

The current frontend flow is local state and fictional mock data only. It has no live carrier, tracking, prediction, or phone-call connection.

The call monitor uses a typed lifecycle and placeholder fields for a future run ID, status, timestamps, completion reason, structured result, and error state. Real cancellation and hang-up behavior remain dependent on future CALL-E capabilities.

## Data and security boundaries

- CALL-E credentials remain on the server.
- The browser must not call CALL-E with a private API key.
- Phone numbers must never be committed to Git.
- Raw transcripts are not stored by default.
- Consent is collected before placing a call.
- Structured results are preferred over unnecessary long-term storage of recordings or transcripts.
