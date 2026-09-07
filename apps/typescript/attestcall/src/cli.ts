#!/usr/bin/env node
/**
 * AttestCall CLI.
 *
 *   attestcall preview  --vendor "Acme" --phone +14155550123 --framework PCI-DSS --by "You"
 *   attestcall attest   --vendor "Acme" --phone +14155550123 --framework PCI-DSS --by "You" [--scenario compliant]
 *   attestcall verify
 *
 * DEMO_MODE=true (default) uses fixtures; set DEMO_MODE=false + CALLE_API_KEY for real calls.
 */
import { loadConfig } from "./config.js";
import { preview, run } from "./runner.js";
import { AuditChain } from "./audit.js";
import type { AttestationRequest, Framework } from "./types.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function buildRequest(args: Record<string, string>): AttestationRequest {
  const req: AttestationRequest = {
    vendorName: args.vendor ?? "",
    vendorPhone: args.phone ?? "",
    framework: (args.framework ?? "PCI-DSS") as Framework,
    requestedBy: args.by ?? "Compliance Team",
  };
  if (args.ref) req.referenceId = args.ref;
  if (args.region) req.region = args.region;
  if (args.locale) req.locale = args.locale;
  return req;
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);
  const config = loadConfig();

  switch (command) {
    case "preview": {
      const p = preview(buildRequest(args), config);
      console.log(JSON.stringify(p, null, 2));
      break;
    }
    case "attest": {
      const runOpts = args.scenario ? { fixtureScenario: args.scenario } : {};
      const { record, chainIntact } = await run(buildRequest(args), config, runOpts);
      console.log(JSON.stringify({ record, chainIntact }, null, 2));
      console.log(`\nDisposition: ${record.disposition.toUpperCase()}  (mode: ${record.mode})`);
      break;
    }
    case "verify": {
      const chain = new AuditChain(config.auditFile);
      const result = chain.verify();
      console.log(
        JSON.stringify({ records: chain.length, ...result }, null, 2),
      );
      break;
    }
    default:
      console.log(
        [
          "AttestCall - compliance attestation by phone (CALL-E).",
          "",
          "Commands:",
          "  preview  --vendor <name> --phone <E.164> --framework <F> --by <requester>",
          "  attest   --vendor <name> --phone <E.164> --framework <F> --by <requester> [--scenario <s>]",
          "  verify",
          "",
          "Frameworks: PCI-DSS | SOC2-TYPE2 | ISO-27001 | HIPAA | GDPR",
          "Demo scenarios: compliant | non_compliant | no_consent | low_confidence | call_failed",
          "",
          `Mode: ${config.demo ? "DEMO (no live calls)" : "LIVE"}`,
        ].join("\n"),
      );
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
