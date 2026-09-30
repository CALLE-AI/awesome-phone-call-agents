# CallOps — repair follow-up demo

A supplier expects the replacement part on Friday. Does that mean the customer's repaired machine returns on Friday? CallOps separates those dates and prepares a customer update supported by the response.

**UI-02 is a runnable no-call contribution draft.** It includes the fictional workshop simulation, a bundled synthetic evidence reader, the reusable CALL-E backend adapter and bounded Core integration, and their hermetic tests. The backend is disabled by default and is not imported by the browser. Authenticated MCP access and tool schemas were observed on September 13, 2026; the backend was adapted to those schemas. The private operator is prepared and locally tested. A representative real phone execution and live-result interpretation remain unqualified.

## Requirements and setup

Use Node.js 22.12–22.x and npm 11.6.0. No private dependencies, credentials, phone number or provider account are required.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

Open `http://127.0.0.1:4173/`. Installation downloads the pinned public build/test toolchain. The application itself makes no provider requests and places no calls. Stop the development server with Ctrl+C.

## Usage

Start with **Part expected · return unknown**. Review the questions and shared information, check the approval box, approve the brief, run the simulation and advance its two manual steps. An estimated part arrival stays separate from the unconfirmed device return. Each suggested sentence has a source. Edit/copy the customer draft; nothing is sent.

Use **New simulation** for confirmed return, conflicting dates or unreachable supplier. A changed question invalidates approval. Reloading resumes saved progress without starting twice. Draft edits last only until reload/reset. Unusable storage offers a temporary session or reset of the app's own data.

Open **Evidence reader** or `/replay.html` to read all four terminal outcomes directly. Exact-byte integrity and a closed synthetic schema are checked before rendering. No uploads or remote replay URLs are accepted. The hash does not prove a real phone call occurred. [Format and provenance](docs/public/replay-format.md).

## Verification

```sh
npm run setup:calle
npm run check
```

`setup:calle` installs the pinned public CALL-E Core 0.2.3 and CLI 0.3.7 dependencies under `tools/calle-cli`, with installation scripts disabled. It does not log in, inspect an account or contact the CALL-E service. This separate toolchain is needed for the backend tests, not for trying the browser simulation.

`check` runs type checking, lint, the workflow/reader and backend tests, and a production build. The Core tests use the real pinned package code with synthetic temporary credentials and a fake HTTP implementation. The September 14 standalone export passes 214 tests, type checking, lint and production build after clean offline installation. Tests cover exact-plan approval, duplicate execution, response uncertainty, nested result evidence, bounded polling and restart checkpoints. They require no real authentication. An older owner-specific Gate A proposal test stays in the development repository with all its assertions; no private approval history is exported.

```sh
npm run build
npm run preview
```

The production build blocks application connections through its content policy. It serves its own static files only. Playwright CLI QA routines are included under `scripts/`; they target a separately started local built app. Their Chromium screenshots contain only fictional demo data.

## Architecture and side effects

TypeScript/Vite, a provider port, exact-brief approval, a state machine, validated browser storage and a bounded deterministic workshop interpreter. The browser persists simulation progress only. The reader is read-only. The reusable Node-side implementation is present as source: `CalleLiveAdapter`, `FixedCalleMcpTransport`, the capability vault and checkpoint stores, result sanitization, and `guarded-calle-core.mjs`. It has no running backend service or live-start entry point in this draft. There is no phone/contact editor, account login, retry scheduler, recording upload or automatic customer message.

The vocabulary is intentionally limited to the scripted corpus. It is not a general conversation parser. [Integration boundaries and setup status](docs/public/private-integration.md) explains the reusable code, operator responsibilities and remaining composition. No hidden credential setting switches the browser to live mode.

## Source and rights

`SOURCE_EXPORT.json` identifies the development commit/tree, exact exported bytes and deliberate transformations. The package scripts select public checks; README and checkout attributes are prepared for this standalone app. No node_modules, personal runtime/bootstrap, private history, protected caches or raw real recordings are copied.

[Dependency and asset notes](docs/public/licenses.md). Vite's browser helper notice is in `public/THIRD_PARTY_NOTICES.txt`. CallOps source code is provided under the [MIT License](LICENSE); dependencies keep their own licenses. The package is marked private to prevent accidental npm publication. The contribution demonstrates a simulation and reusable integration source; a representative live call remains unqualified.
