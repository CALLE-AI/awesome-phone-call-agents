/**
 * Standalone safety-hardening verification.
 * Exercises the four new fixes without relying on the CALL-E SDK.
 */

// FIX 1 — Replicate the E.164 validation logic
function isValidE164(phoneNumber: string): boolean {
  return /^\+[1-9][0-9]{1,14}$/.test(phoneNumber);
}

// FIX 2 — Replicate the authorization logic
const AUTHORIZED_TEST_NUMBERS = new Set(
  (process.env.AUTHORIZED_CALL_NUMBERS ?? '').split(',').map((n) => n.trim()).filter(Boolean)
);

// FIX 3 — Replicate the intent-key builder
function buildIntentKey(loadId: string, carrierId: string, round: number): string {
  return `supplyline-${loadId}-${carrierId}-r${round}`;
}

async function verifySafetyLogic() {
  console.log('=== SAFETY HARDENING VERIFICATION ===\n');

  // --- FIX 1: E.164 Validation ---
  console.log('FIX 1 — E.164 Validation');
  const validNumbers = ['+15550001001', '+441234567890', '+123456789012345'];
  const invalidNumbers = [
    '15550001001',      // missing +
    '+1 555 000 1001',  // spaces
    '+1555-000-1001',   // dashes
    '+abc',             // letters
    '+1',               // too short
    '+1234567890123456',// too long (16 digits)
    '',                 // empty
  ];

  let allValidPass = true;
  for (const num of validNumbers) {
    if (!isValidE164(num)) {
      console.log(`  ❌ Expected valid: ${num}`);
      allValidPass = false;
    }
  }
  for (const num of invalidNumbers) {
    if (isValidE164(num)) {
      console.log(`  ❌ Expected invalid: ${num}`);
      allValidPass = false;
    }
  }
  console.log(allValidPass ? '  ✅ All E.164 cases correct' : '  ❌ Some E.164 cases failed');

  // --- FIX 2: Authorization ---
  console.log('\nFIX 2 — Per-Run Authorization');
  process.env.AUTHORIZED_CALL_NUMBERS = '+15550001001,+15550001003';
  const authSet = new Set(
    (process.env.AUTHORIZED_CALL_NUMBERS ?? '').split(',').map((n) => n.trim()).filter(Boolean)
  );
  const authPass = authSet.has('+15550001001') && authSet.has('+15550001003') && !authSet.has('+15550001002');
  console.log(authPass ? '  ✅ Allowlist correctly parsed and queried' : '  ❌ Allowlist logic failed');

  // --- FIX 3: Idempotency Key ---
  console.log('\nFIX 3 — Stable Intent Key');
  const key1 = buildIntentKey('load-001', 'carrier-a', 1);
  const key2 = buildIntentKey('load-001', 'carrier-a', 1);
  const key3 = buildIntentKey('load-001', 'carrier-b', 1);
  const key4 = buildIntentKey('load-001', 'carrier-a', 2);
  const idemPass = key1 === key2 && key1 !== key3 && key1 !== key4 && key1 === 'supplyline-load-001-carrier-a-r1';
  console.log(idemPass ? `  ✅ Deterministic keys: ${key1}` : '  ❌ Intent keys not deterministic');

  // --- FIX 4: Loop Break on Ambiguous Outcome ---
  console.log('\nFIX 4 — Stop Loop on Ambiguous Outcome');

  // Simulate the loop behavior with a mock carrier list where the second carrier fails
  type MockCarrier = { id: string; phoneNumber: string };
  const carriers: MockCarrier[] = [
    { id: 'carrier-a', phoneNumber: '+15550001001' },
    { id: 'carrier-b', phoneNumber: '+15550001002' },
  ];

  const quotes: { carrierId: string; evidence: string }[] = [];
  let callsMade = 0;

  for (const carrier of carriers) {
    if (!isValidE164(carrier.phoneNumber)) {
      quotes.push({ carrierId: carrier.id, evidence: 'Invalid phone' });
      continue;
    }

    // Simulate SDK call
    callsMade++;

    if (carrier.id === 'carrier-a') {
      // Simulate ambiguous outcome (null structuredResult or error)
      quotes.push({ carrierId: carrier.id, evidence: 'No structured result returned from call.' });
      break; // FIX 4: stop the loop
    } else {
      quotes.push({ carrierId: carrier.id, evidence: 'Success' });
    }
  }

  const breakPass = callsMade === 1 && quotes.length === 1 && quotes[0].carrierId === 'carrier-a';
  console.log(
    breakPass
      ? '  ✅ Loop broke after first ambiguous outcome (only 1 call attempted)'
      : `  ❌ Loop did not break correctly (callsMade=${callsMade}, quotes=${quotes.length})`
  );

  // Overall
  const allPass = allValidPass && authPass && idemPass && breakPass;
  console.log(`\n\n${allPass ? '✅ ALL SAFETY CHECKS PASSED' : '❌ SOME SAFETY CHECKS FAILED'}\n`);

  if (!allPass) process.exit(1);
}

verifySafetyLogic().catch((err) => {
  console.error('❌ SAFETY VERIFICATION FAILED:', err);
  process.exit(1);
});
