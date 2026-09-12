/**
 * Places ONE real CALL-E call, to ONE number given explicitly on the command
 * line, and prints exactly what came back.
 *
 * This is the only path in the codebase that dials a number a human typed. It
 * deliberately refuses to take a number from discovery: ringing a real business
 * has to be a deliberate act, not a side effect of running a script.
 *
 *   npm run calle:verify -- --to +353871234567
 *   npm run calle:verify -- --to +353871234567 --family repair_quote
 *
 * Requires CALLE_API_KEY and TEST_PROVIDER=real. Costs credit. Rings a phone.
 */
import { loadConfig } from '@dial/config';
import { CalleCallProvider, callIdempotencyKey, isTerminal } from '@dial/calle';
import { getCallFamily, CALL_FAMILY_IDS, type CallFamilyId } from '@dial/schemas';
import { normalizePhone, isBlockedNumber } from '@dial/domain';

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? (process.argv[index + 1] ?? null) : null;
}

/**
 * npm strips unknown flags when forwarding through a workspace script, so
 * `--to` can be eaten before it reaches us. Accept a bare E.164 positional as
 * well, which survives that round trip intact.
 */
function positionalNumber(): string | null {
  return process.argv.slice(2).find((value) => /^\+[1-9]\d{6,14}$/.test(value)) ?? null;
}

async function main(): Promise<void> {
  const to = arg('to') ?? positionalNumber();
  const familyId = (arg('family') ?? 'general_inquiry') as CallFamilyId;

  if (!to) {
    console.error('Usage: npm run calle:verify -- --to +<E.164 number> [--family <id>]');
    console.error(`Families: ${CALL_FAMILY_IDS.join(', ')}`);
    process.exit(1);
  }
  if (!CALL_FAMILY_IDS.includes(familyId)) {
    console.error(`Unknown family "${familyId}". One of: ${CALL_FAMILY_IDS.join(', ')}`);
    process.exit(1);
  }

  const normalized = normalizePhone(to);
  if (!normalized) {
    console.error(`"${to}" is not a valid phone number. Give it in full international form.`);
    process.exit(1);
  }
  if (isBlockedNumber(normalized.e164)) {
    console.error(`${normalized.e164} is in a premium-rate or reserved range. Refusing.`);
    process.exit(1);
  }

  const config = loadConfig();
  if (config.callMode !== 'real') {
    console.error('TEST_PROVIDER is not "real". Refusing to pretend this was a real call.');
    process.exit(1);
  }
  if (!config.calle.configured) {
    console.error('CALLE_API_KEY is not set.');
    process.exit(1);
  }

  const family = getCallFamily(familyId);
  const provider = new CalleCallProvider(config.calle.apiKey, config.calle.baseUrl);

  console.log('');
  console.log('  ⚠  THIS WILL PLACE A REAL PHONE CALL AND SPEND REAL CREDIT.');
  console.log(`     Number : ${normalized.e164}`);
  console.log(`     Family : ${family.id}`);
  console.log(`     Base   : ${config.calle.baseUrl}`);
  console.log('');
  console.log('     Only continue if you own this number or are authorised to call it.');
  console.log('     Starting in 5 seconds — Ctrl-C to abort.');
  console.log('');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const brief = [
    'You are an AI assistant placing a verification call on behalf of the Dial engineering team.',
    'Identify yourself as an AI assistant at the start of the call.',
    'Say that this is a short test call to confirm the system works, ask whether the person can hear you clearly,',
    'thank them, and end the call. Keep it under thirty seconds.',
    'Do not ask for any personal information. Do not agree to anything.',
  ].join(' ');

  const idempotencyKey = callIdempotencyKey('verify', normalized.e164.replace(/\D/g, ''), 1);

  console.log('Creating call...');
  const created = await provider.create({
    task: brief,
    phone: normalized.e164,
    resultSchema: family.resultSchema,
    metadata: { purpose: 'engineering_verification' },
    idempotencyKey,
  });

  console.log('');
  console.log(`  CALL-E call id : ${created.providerCallId}`);
  console.log(`  status         : ${created.status}`);
  console.log('');

  const deadline = Date.now() + 5 * 60_000;
  let snapshot = created;

  while (!isTerminal(snapshot.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    snapshot = await provider.get(created.providerCallId);
    console.log(`  ... ${snapshot.status}`);
  }

  console.log('');
  console.log('  TERMINAL RESULT');
  console.log(`  status            : ${snapshot.status}`);
  console.log(`  task_completed    : ${snapshot.taskCompleted}`);
  console.log(`  confidence        : ${JSON.stringify(snapshot.completionConfidence)}`);
  console.log(`  failure           : ${snapshot.failureCode ?? 'none'} ${snapshot.failureMessage ?? ''}`);
  console.log(`  structured_result : ${JSON.stringify(snapshot.structuredResult, null, 2)}`);
  console.log(`  evidence          : ${JSON.stringify(snapshot.evidence)}`);
  console.log(`  attempts          : ${snapshot.attempts.length}`);
  for (const attempt of snapshot.attempts) {
    console.log(`    - ${attempt.status} ${attempt.phoneMasked} (${attempt.transcript.length} turns)`);
  }
  console.log('');

  if (snapshot.structuredResult === null) {
    console.log('  structured_result is null — CALL-E could not produce a schema-valid result.');
    console.log('  Dial treats this as "needs review" and does NOT act on it.');
  }
}

main().catch((error) => {
  console.error('');
  console.error(`  FAILED: ${(error as Error).message}`);
  const code = (error as { code?: string }).code;
  if (code) console.error(`  code: ${code}`);
  process.exit(1);
});
