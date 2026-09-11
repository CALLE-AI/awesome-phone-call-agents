/**
 * Headless harness. Runs the exact same engine modules the browser runs, so the
 * measured numbers reported in the terminal and in the UI come from one codepath.
 *   node app/tools/smoke.mjs [budget]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VerificationEngine } from '../js/engine.js';
import { countUngroundedPublishes } from '../js/evaluate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = JSON.parse(readFileSync(resolve(HERE, '../data/directory.json'), 'utf8'));
const gt = JSON.parse(readFileSync(resolve(HERE, '../data/ground-truth.json'), 'utf8'));

const budget = Number(process.argv[2] ?? 25);
const NOW = Date.parse(dir.as_of);
const eng = new VerificationEngine(dir, gt, { now: NOW });

const { plan, baseline } = eng.planCalls(budget);
console.log(`facilities ingested        ${eng.facilities.length}`);
console.log(`total available harm       ${eng.totalAvailableHarm.toFixed(2)}`);
console.log(`plan (risk greedy)         ${plan.calls.length} calls, expected harm reduction ${plan.expectedHarmReduction.toFixed(3)}`);
console.log(`baseline (oldest first)    ${baseline.calls.length} calls, expected harm reduction ${baseline.expectedHarmReduction.toFixed(3)}`);
console.log(`planned lift               ${(((plan.expectedHarmReduction / baseline.expectedHarmReduction) - 1) * 100).toFixed(1)}%`);

await eng.runPlan(plan);
await eng.runBaselineCounterfactual();
const ev = eng.evaluate();

console.log('\n--- measured, before human review ---');
console.log(`calls placed               ${ev.callsPlaced} (attempts ${ev.totalAttempts})`);
console.log(`connected                  ${ev.connected}`);
console.log(`voicemail                  ${ev.voicemail}`);
console.log(`no answer / busy           ${ev.noAnswer}`);
console.log(`dead line / ivr dead end   ${ev.deadLine}`);
console.log(`attempt-level outcomes     ${JSON.stringify(ev.attemptOutcomes)}`);
console.log(`attempted field-facts      ${ev.attempted}`);
console.log(`grounded                   ${ev.grounded}`);
console.log(`precision                  ${(ev.precision * 100).toFixed(1)}%`);
console.log(`recall                     ${(ev.recall * 100).toFixed(1)}%`);
console.log(`unknown rate               ${(ev.unknownRate * 100).toFixed(1)}%`);
console.log(`auto-published             ${ev.falsePublishAutoOnly.published}, wrong ${ev.falsePublishAutoOnly.wrong} (${(ev.falsePublishAutoOnly.rate * 100).toFixed(2)}%)`);
console.log(`review queue               ${ev.reviewQueueSize}`);
console.log(`ungrounded publishes       ${ev.citationGate.ungroundedPublishes}`);
console.log(`spans resolved             ${ev.citationGate.spanCheck.resolved}/${ev.citationGate.spanCheck.total}`);
if (ev.citationGate.spanCheck.failures.length) console.log('SPAN FAILURES', ev.citationGate.spanCheck.failures.slice(0, 5));

const approved = eng.approveAll();
const ev2 = eng.evaluate();
console.log('\n--- after human approves the review queue ---');
console.log(`approved from review       ${approved.length}`);
console.log(`published total            ${ev2.publishedCount}`);
console.log(`false publish rate         ${(ev2.falsePublish.rate * 100).toFixed(2)}% (${ev2.falsePublish.wrong}/${ev2.falsePublish.published})`);
console.log(`ungrounded publishes       ${countUngroundedPublishes(eng.store.published)}`);
console.log(`spans resolved             ${ev2.citationGate.spanCheck.resolved}/${ev2.citationGate.spanCheck.total}`);

console.log('\n--- harm reduction, realized against ground truth ---');
console.log(`risk-ranked plan           ${ev2.harmRealized.toFixed(3)}`);
console.log(`naive oldest-first         ${ev2.baseline.harmRealized.toFixed(3)}`);
console.log(`lift                       ${(((ev2.harmRealized / ev2.baseline.harmRealized) - 1) * 100).toFixed(1)}%`);
console.log(`baseline connected         ${ev2.baseline.connected}/${ev2.baseline.callsPlaced}`);

console.log('\n--- per field ---');
for (const [f, v] of Object.entries(ev2.perField)) {
  console.log(
    `${f.padEnd(22)} att ${String(v.attempted).padStart(3)}  grounded ${String(v.grounded).padStart(3)}  ` +
      `P ${v.precision === null ? ' n/a ' : (v.precision * 100).toFixed(0).padStart(3) + '%'}  ` +
      `R ${v.recall === null ? ' n/a ' : (v.recall * 100).toFixed(0).padStart(3) + '%'}  ` +
      `unk ${((v.unknownRate ?? 0) * 100).toFixed(0).padStart(3)}%`,
  );
}
if (ev2.falsePublish.examples.length) {
  console.log('\n--- what got published wrong (all traceable to a quote) ---');
  for (const e of ev2.falsePublish.examples)
    console.log(`  ${e.facilityId} ${e.field}: published ${e.published} / truth ${e.truth} / conf ${e.confidence} / hedged ${e.hedged} / "${e.quote}"`);
}
