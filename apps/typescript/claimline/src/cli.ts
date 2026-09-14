import { ClaimLineApp } from "./app.js";
import { maskPhone } from "./domain/phone.js";
import type { CallType } from "./domain/types.js";
import type { ClaimView } from "./app.js";

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
}

function resolveCallType(value: string | boolean | undefined): CallType {
  const v = String(value ?? "fnol").toLowerCase();
  if (v === "status" || v === "status_chase") return "status_chase";
  return "fnol_intake";
}

function line(char = "-", n = 64): string {
  return char.repeat(n);
}

function resolveClaimId(app: ClaimLineApp, ref: string): string {
  const byRef = app.store.getClaimByReference(ref);
  if (byRef) return byRef.id;
  const byId = app.store.getClaim(ref);
  if (byId) return byId.id;
  throw new Error(`No claim found for "${ref}" (try a reference like CLM-1001).`);
}

function printPreview(view: ReturnType<ClaimLineApp["dispatcher"]["preview"]>): void {
  console.log(`  call type:   ${view.callType}`);
  console.log(`  claim:       ${view.claimReference} (${view.policyholderName})`);
  console.log(`  destination: ${view.maskedDestination}  [masked]`);
  console.log(`  region/lang: ${view.region} / ${view.locale}`);
  console.log(`  schema:      ${view.schemaVersion}`);
  console.log(`  spoken goal:`);
  for (const l of view.task.split("\n")) console.log(`    | ${l}`);
}

function printClaimView(view: ClaimView): void {
  const c = view.claim;
  console.log(line("="));
  console.log(`${c.reference}  ${c.policyholderName}  [${c.incidentType}]`);
  console.log(`claimant: ${maskPhone(c.claimantPhone)}   provider: ${
    c.providerName ?? "-"
  } ${c.providerPhone ? maskPhone(c.providerPhone) : ""}`);
  if (view.intents.length === 0) {
    console.log("  (no calls yet)");
  }
  for (const { intent, result, decision } of view.intents) {
    console.log(line());
    console.log(
      `  call ${intent.callType}  state=${intent.state}  id=${intent.id.slice(0, 8)}`,
    );
    if (intent.reason) console.log(`    reason: ${intent.reason}`);
    if (result) {
      console.log(
        `    disposition: ${result.disposition} (${result.dispositionReason})`,
      );
      console.log(
        `    confidence:  ${result.confidenceScore ?? "-"} ${
          result.confidenceLabel ? `(${result.confidenceLabel})` : ""
        }`,
      );
      if (result.summary) console.log(`    summary:     ${result.summary}`);
      if (result.structuredResult) {
        console.log(`    structured:  ${JSON.stringify(result.structuredResult)}`);
      }
      if (result.evidence.length > 0) {
        console.log(`    evidence:`);
        for (const e of result.evidence) console.log(`      - ${e}`);
      }
    }
    if (decision) {
      console.log(
        `    DECISION:    "${decision.decision}" by ${decision.decidedBy}${
          decision.note ? ` — ${decision.note}` : ""
        }`,
      );
    }
  }
}

async function run(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  const app = new ClaimLineApp();
  const mode = app.config.mode.toUpperCase();

  try {
    switch (command) {
      case "seed": {
        const claims = app.seedDemo();
        console.log(`Seeded ${claims.length} demo claim(s) [mode=${mode}]:`);
        for (const c of claims) console.log(`  ${c.reference}  ${c.policyholderName}`);
        break;
      }

      case "claims": {
        const views = app.listClaimViews();
        if (views.length === 0) console.log("No claims yet. Run: claimline seed");
        for (const v of views) printClaimView(v);
        break;
      }

      case "show": {
        const ref = String(flags.claim ?? positional[0] ?? "");
        if (!ref) throw new Error("usage: show --claim CLM-1001");
        const view = app.getClaimView(resolveClaimId(app, ref));
        if (!view) throw new Error(`claim not found: ${ref}`);
        printClaimView(view);
        break;
      }

      case "preview": {
        const ref = String(flags.claim ?? positional[0] ?? "");
        if (!ref) throw new Error("usage: preview --claim CLM-1001 --type fnol|status");
        const callType = resolveCallType(flags.type);
        console.log(`Preview (no call placed) [mode=${mode}]:`);
        printPreview(app.dispatcher.preview(resolveClaimId(app, ref), callType));
        break;
      }

      case "call": {
        const ref = String(flags.claim ?? positional[0] ?? "");
        if (!ref) throw new Error("usage: call --claim CLM-1001 --type fnol [--confirm] [--scenario name]");
        const callType = resolveCallType(flags.type);
        const confirm = flags.confirm === true || flags.confirm === "true";
        const fixtureScenario =
          typeof flags.scenario === "string" ? flags.scenario : undefined;
        const outcome = await app.dispatcher.dispatch(
          resolveClaimId(app, ref),
          callType,
          { confirm, ...(fixtureScenario ? { fixtureScenario } : {}) },
        );
        console.log(`Dispatch [mode=${mode}] -> ${outcome.status}`);
        if (outcome.reason) console.log(`  reason: ${outcome.reason}`);
        console.log(`  intent: ${outcome.intent.id} (state=${outcome.intent.state})`);
        if (outcome.status === "preview") {
          console.log("  (no call placed — re-run with --confirm to dial)");
          printPreview(outcome.preview);
        }
        break;
      }

      case "reconcile": {
        const summary = await app.reconciler.pollOnce();
        console.log(`Reconcile [mode=${mode}]:`, JSON.stringify(summary));
        break;
      }

      case "cancel": {
        const id = String(flags.intent ?? positional[0] ?? "");
        if (!id) throw new Error("usage: cancel --intent <intent-id>");
        const intent = app.dispatcher.cancel(id);
        console.log(`Canceled intent ${intent.id} (state=${intent.state})`);
        break;
      }

      case "decide": {
        const id = String(flags.intent ?? positional[0] ?? "");
        const by = String(flags.by ?? "operator");
        const decision = String(flags.decision ?? "");
        const note = typeof flags.note === "string" ? flags.note : null;
        if (!id || !decision) {
          throw new Error('usage: decide --intent <id> --decision "..." [--by name] [--note "..."]');
        }
        const intent = app.applyDecision(id, { decidedBy: by, decision, note });
        console.log(`Recorded decision on ${intent.id} (state=${intent.state})`);
        break;
      }

      case "demo": {
        await runDemo(app);
        break;
      }

      default:
        printHelp();
    }
  } finally {
    app.close();
  }
}

async function runDemo(app: ClaimLineApp): Promise<void> {
  const mode = app.config.mode.toUpperCase();
  console.log(line("="));
  console.log(`ClaimLine end-to-end demo  [mode=${mode}]`);
  console.log("No real call is placed in fixture mode.");
  console.log(line("="));

  const [ravi, maria] = app.seedDemo();
  console.log(`\n1) Seeded demo claims: ${ravi!.reference}, ${maria!.reference}`);

  console.log(`\n2) FNOL intake preview for ${ravi!.reference} (masked, no call):`);
  printPreview(app.dispatcher.preview(ravi!.id, "fnol_intake"));

  console.log(`\n3) Operator confirms -> place FNOL intake call:`);
  const fnol = await app.dispatcher.dispatch(ravi!.id, "fnol_intake", {
    confirm: true,
    fixtureScenario: "fnol_ok",
  });
  console.log(`   dispatch -> ${fnol.status} (state=${fnol.intent.state})`);

  console.log(`\n4) Status-chase call to the repair shop:`);
  const status = await app.dispatcher.dispatch(ravi!.id, "status_chase", {
    confirm: true,
    fixtureScenario: "status_ok",
  });
  console.log(`   dispatch -> ${status.status} (state=${status.intent.state})`);

  console.log(`\n5) A second claim reaches voicemail -> must NOT be guessed:`);
  const voicemail = await app.dispatcher.dispatch(maria!.id, "status_chase", {
    confirm: true,
    fixtureScenario: "voicemail",
  });
  console.log(`   dispatch -> ${voicemail.status} (state=${voicemail.intent.state})`);

  console.log(`\n6) Reconcile (fetch authoritative state, verify, classify):`);
  const summary = await app.reconciler.pollOnce();
  console.log(`   ${JSON.stringify(summary)}`);

  console.log(`\n7) Results:`);
  const raviView = app.getClaimView(ravi!.id);
  const mariaView = app.getClaimView(maria!.id);
  if (raviView) printClaimView(raviView);
  if (mariaView) printClaimView(mariaView);

  console.log(`\n8) Human records a decision on the verified FNOL intake:`);
  const fnolIntent = app.store
    .listIntentsByClaim(ravi!.id)
    .find((i) => i.callType === "fnol_intake");
  if (fnolIntent && fnolIntent.state === "terminal_verified") {
    const applied = app.applyDecision(fnolIntent.id, {
      decidedBy: "Priya (claims handler)",
      decision: "accept_intake_open_adjuster_task",
      note: "Intake complete; assigned to adjuster queue.",
    });
    console.log(`   intent ${applied.id.slice(0, 8)} -> ${applied.state}`);
  }
  console.log(`\nDemo complete.`);
}

function printHelp(): void {
  console.log(`ClaimLine CLI — insurance FNOL intake + claim-status chasing via CALL-E

Safe by default: fixture mode places NO real calls. Live mode requires
CLAIMLINE_MODE=live and CALLE_API_KEY, and a call is only placed with --confirm.

Commands:
  seed                                   Create demo claims (CLM-1001, CLM-1002)
  claims                                 List all claims and their calls
  show     --claim CLM-1001              Show one claim with results/transcript
  preview  --claim CLM-1001 --type fnol  Print masked call preview (no call)
  call     --claim CLM-1001 --type fnol [--confirm] [--scenario name]
                                         Dispatch a call (preview unless --confirm)
  reconcile                              Poll in-flight calls; verify + classify
  cancel   --intent <id>                 Cancel a reserved intent before dialing
  decide   --intent <id> --decision "..." [--by name] [--note "..."]
                                         Record a human decision (applies it)
  demo                                   Run the full no-call end-to-end demo

Types: fnol (default) | status
Fixture scenarios: fnol_ok, status_ok, voicemail, refusal, low_confidence, failed`);
}

run().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
