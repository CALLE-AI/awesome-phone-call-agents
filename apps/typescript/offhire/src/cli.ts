import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { demoRentals, fixtureCall } from "./core/fixtures";
import { reconcileCall } from "./core/decision";
import {
  cancelPrepared,
  loadRun,
  maskPhone,
  prepareRun,
  refreshRun,
  submitRun,
  summary,
  unlockRun,
  UserError,
  type Settings,
} from "./run";
const help = `OffHire: pickup is not an off-rent billing confirmation.
Commands (default: demo; no call):
  demo
  preview --input rental.private.json --state .state/rehearsal
  inspect --state .state/rehearsal
  start --state .state/rehearsal --approve <printed-plan-digest>
  status --state .state/rehearsal
  recover --state .state/rehearsal --approve <same-plan-digest>
  cancel --state .state/rehearsal
  unlock --state .state/rehearsal --confirm-process-stopped
Read README.md before live calling. No automatic redial or recurring schedule.`;
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      input: { type: "string" },
      state: { type: "string" },
      approve: { type: "string" },
      help: { type: "boolean" },
      "confirm-process-stopped": { type: "boolean" },
    },
  });
  const command = positionals[0] || "demo";
  if (values.help) {
    console.log(help);
    return;
  }
  if (command === "demo") {
    const r = demoRentals("synthetic")[0];
    console.log(
      "OFFHIRE — SYNTHETIC DEMONSTRATION. No phone calls or network requests.",
    );
    for (const scenario of [
      "confirmed",
      "ambiguous",
      "contradiction",
    ] as const) {
      const d = reconcileCall(fixtureCall(r, scenario), r);
      console.log(
        JSON.stringify(
          {
            scenario,
            billing: d.billing,
            pickup: d.pickup,
            title: d.title,
            reasons: d.reasons,
          },
          null,
          2,
        ),
      );
    }
    return;
  }
  if (!values.state)
    throw new UserError("Specify --state <private-run-directory>.");
  const s: Settings = {
    apiKey: process.env.CALLE_API_KEY,
    enabled: process.env.OFFHIRE_LIVE_ENABLED === "true",
    authorized: process.env.OFFHIRE_CONTACT_AUTHORIZED === "true",
    phone: process.env.OFFHIRE_AUTHORIZED_PHONE,
    expiresAt: process.env.OFFHIRE_AUTHORIZATION_EXPIRES_AT,
  };
  if (command === "preview") {
    if (!values.input)
      throw new UserError("Provide --input rental.private.json.");
    const r = await prepareRun(
      JSON.parse(await readFile(values.input, "utf8")),
      values.state,
    );
    console.log(
      JSON.stringify(
        {
          mode: "PREVIEW ONLY — no call",
          phone: maskPhone(r.rental.phone),
          expiresAt: r.expiresAt,
          approvalDigest: r.digest,
          review: `Read ${values.state}/plan.json privately before starting. The full number is saved there, but no API key is stored.`,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "inspect") {
    console.log(JSON.stringify(summary(await loadRun(values.state)), null, 2));
    return;
  }
  if (command === "unlock") {
    await unlockRun(values.state, values["confirm-process-stopped"] === true);
    console.log(
      "Local lock removed. No call was created or canceled. Inspect the saved state before recovery.",
    );
    return;
  }
  const result =
    command === "start"
      ? await submitRun(values.state, s, values.approve)
      : command === "recover"
        ? await submitRun(values.state, s, values.approve, true)
        : command === "status"
          ? await refreshRun(values.state, s)
          : command === "cancel"
            ? await cancelPrepared(values.state)
            : null;
  if (!result) throw new UserError("Unknown command. Use --help.");
  console.log(JSON.stringify(summary(result), null, 2));
}
main().catch((error) => {
  console.error(
    error instanceof UserError
      ? error.message
      : "Action failed. Private state is retained. Check local inputs/configuration; do not create a replacement for an uncertain call.",
  );
  process.exitCode = 1;
});
