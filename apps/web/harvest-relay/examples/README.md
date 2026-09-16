# Reproduce the response-to-plan integration

Run from the project root with Node 20 or newer:

```bash
node scripts/integration-demo.mjs
```

No credentials or network connection are needed. The command imports the bundled storage response, saves it, imports the carrier response into that saved scenario, then runs the same solver used by the website. It prints **0 calls**, a computed **$310** Riverside + Swift handoff at **14:25**, and private artifact paths under `runtime/demo/`.

`context.json` begins with every provider unknown. The two `.TEST.json` files follow the official completed CALL-E CallTask response shape. All IDs, conversations, prices and providers are invented. The phone numbers are in the reserved fictional NANP 555-0100–0199 range; do not dial them. These files demonstrate parsing, review gates, persistence and computation, and do not establish live API access or real provider confirmation.

Inspect each response's `recipients[0].structured_result`, transcript and date/timezone, then reproduce the individual CLI steps if desired:

```bash
node src/cli.mjs ingest --file examples/storage-call.TEST.json --type storage --provider riverside --scenario examples/context.json --output runtime/example-storage.json --reviewed
node src/cli.mjs ingest --file examples/carrier-call.TEST.json --type carrier --provider swift --scenario runtime/example-storage.json --output runtime/example-combined.json --reviewed
node src/cli.mjs solve --scenario runtime/example-combined.json
```

Choose new output filenames on repeated manual runs; existing snapshots are preserved. The automated demo creates a fresh directory each time. For actual operator-supplied results, provide the exact scenario's local service date, timezone and lot facts, review the real recipient transcript before using `--reviewed`, and keep those imports separate from these TEST fixtures.
