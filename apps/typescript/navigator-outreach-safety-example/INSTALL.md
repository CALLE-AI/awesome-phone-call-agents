# Installation and verification

Node.js 22+ is the tested runtime.

```sh
npm ci
npm run verify
```

`npm run verify` runs the test suite, TypeScript checking, and the local build check. It does not require a credential and makes no network or telephone request.

Expected safety state:

```text
CALL_EXECUTION_ENABLED=false
CONTROLLED_CALL_GO=false
MAXIMUM_CALLS=0
SHUTDOWN_ACTIVE=true
```

Do not place a real key in `.env.example`, source code, test data, logs, or screenshots. This package intentionally has no command for a live request.
