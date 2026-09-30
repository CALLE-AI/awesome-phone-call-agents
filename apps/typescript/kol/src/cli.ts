import { evaluate } from './eval.ts';
import { makeFixture } from './fixtures.ts';
import { runLiveCall } from './calle.ts';
import { outcomeFromCall, verifyClaimOutcome } from './verify.ts';

const [command = 'demo', ...args] = process.argv.slice(2);

if (command === 'demo') {
  console.log('Kol - evidence-gated payer-call operations');
  console.log('Fixture replay only: no call, no credentials, and no real patient data.\n');
  for (const kind of ['clean_paid', 'wrong_department', 'never_asked', 'route_mismatch'] as const) {
    const result = verifyClaimOutcome(makeFixture(kind, 17).input);
    console.log(`${kind.padEnd(22)} ${result.verdict.padEnd(12)} auto-accept=${result.autoAccept}`);
  }
  console.log('\nRun `npm run eval` for the complete adversarial matrix.');
} else if (command === 'eval') {
  const metrics = evaluate();
  console.log(JSON.stringify(metrics, null, 2));
  if (metrics.unsafeAccepted !== 0 || metrics.safeAccepted !== metrics.safeCases) process.exitCode = 1;
} else if (command === 'live') {
  const to = requiredFlag(args, '--to');
  const authorisedDestination = requiredFlag(args, '--authorise');
  const claimReference = requiredFlag(args, '--claim');
  const expectedDepartment = flag(args, '--department') ?? 'claims status department';
  const route = flag(args, '--route')?.split(',').map((part) => part.trim()).filter(Boolean);
  const call = await runLiveCall({ to, authorisedDestination, claimReference, expectedDepartment, ...(route ? { route } : {}) });
  const extracted = outcomeFromCall(call);
  // A model-reported menu trail cannot verify itself. Live results remain held until an
  // independent provider event, decoded DTMF audio, or owned-fixture log is attached.
  const verification = verifyClaimOutcome({
    call,
    outcome: extracted.outcome,
    expectedClaimReference: claimReference,
    expectedDepartment,
    reportedKeys: extracted.reportedKeys,
  });
  console.log(`\nverdict=${verification.verdict} auto-accept=${verification.autoAccept}`);
  console.log(verification.summary);
  console.log('The raw response was stored under artifacts/. Treat it as sensitive and do not commit it.');
} else {
  console.error('Usage: node src/cli.ts [demo|eval|live]');
  process.exitCode = 2;
}

function flag(args: string[], name: string) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function requiredFlag(args: string[], name: string) { const value = flag(args, name); if (!value) throw new Error(`${name} is required. No call was placed.`); return value; }
