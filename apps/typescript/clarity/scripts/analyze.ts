/**
 * Runs the analyzer against the seeded application and prints what survived the
 * guardrails. Spends Gemini tokens; places no call.
 *
 *   npm run analyze
 */
import demo from "../fixtures/demo-application.json" with { type: "json" };
import { analyze } from "../lib/analyze";
import type { ApplicationInput } from "../lib/types";

const application: ApplicationInput = {
  jobDescription: demo.jobDescription,
  resume: demo.resume,
  answers: demo.answers,
  candidateName: demo.candidateName,
  roleTitle: demo.roleTitle,
};

const started = Date.now();
const { clarifications, rejected } = await analyze(application);
console.log(`model=${process.env.GEMINI_MODEL ?? "(default)"}  ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

for (const [index, c] of clarifications.entries()) {
  const verbatim = application[c.source].includes(c.claim);
  // Only the first is called about, so say which one that is.
  const rank = index === 0 ? "PRIMARY — this is the one that gets called" : `also found (#${index + 1})`;
  console.log(`[${c.id}] from ${c.source}   verbatim=${verbatim ? "✓" : "✗ FAIL"}   ${rank}`);
  console.log(`  CLAIM     "${c.claim}"`);
  console.log(`  TOPIC     ${c.topic ?? "-"}`);
  console.log(`  NEED      ${c.need ?? "-"}`);
  console.log(`  WHY       ${c.whyItMatters}`);
  console.log(`  ASK       "${c.question}"`);
  for (const p of c.probes) console.log(`  PROBE     ${p}`);
  console.log(`  EXTRACT   ${c.extract.join("; ")}\n`);
}

if (rejected.length > 0) {
  console.log("rejected by guardrails:");
  for (const r of rejected) console.log(`  [${r.reason}] "${r.claim}"`);
}
