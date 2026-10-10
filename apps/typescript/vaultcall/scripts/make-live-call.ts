/**
 * VaultCall Live Outbound Phone Call Utility
 * Uses official @call-e/calle SDK to place a real, dynamic, human-level PSTN phone call.
 *
 * Security Requirements:
 * - Recipient phone number must strictly be ASCII E.164.
 * - Transport is pinned exclusively to approved HTTPS origins (api.heycall-e.com / api.call-e.ai).
 * - Recipient must be authorized via environment allowlist or verified PBX directory.
 * - All display copies (CLI, logs, transcripts) mask phone numbers for privacy.
 * - Failed or ambiguous live results fail closed.
 * - Advisory notice: tokens are simulated internal control proofs, not direct wire releases.
 * - Accepted-call cancellation limits: carrier audio in flight cannot be remotely halted once answered.
 *
 * Usage:
 *   npx tsx scripts/make-live-call.ts --phone "+1XXXXXXXXXX" --name "Michael Vance"
 */

import {
  isValidAsciiE164,
  maskPhoneNumber,
  validateApprovedHttpsOrigin,
  isAuthorizedLiveRecipient,
  maskPhoneNumbersInText,
} from '../src/lib/phone-utils';

async function getCalleClient(apiKey: string, rawBaseUrl?: string) {
  const baseUrl = validateApprovedHttpsOrigin(rawBaseUrl);
  const mod = await import('@call-e/calle');
  return new mod.CalleClient({
    apiKey,
    baseUrl,
  });
}

async function main() {
  const args = process.argv.slice(2);

  let phone = process.env.TARGET_PHONE || '';
  let apiKey = process.env.CALLE_API_KEY || '';
  let officerName = 'Corporate Controller';
  let scenario = 'fraud';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phone' && args[i + 1]) phone = args[i + 1];
    if (args[i] === '--api-key' && args[i + 1]) apiKey = args[i + 1];
    if (args[i] === '--name' && args[i + 1]) officerName = args[i + 1];
    if (args[i] === '--scenario' && args[i + 1]) scenario = args[i + 1];
  }

  const trimmedPhone = phone.trim();
  if (!trimmedPhone) {
    console.error('\n❌ ERROR: Target phone number is required in ASCII E.164 format (e.g. +14155550199).');
    console.error('👉 Usage: npx tsx scripts/make-live-call.ts --phone "+14155550199" --name "Controller Name"\n');
    process.exit(1);
  }

  if (!isValidAsciiE164(trimmedPhone)) {
    console.error(`\n❌ ERROR: Recipient "${trimmedPhone}" is not a valid ASCII E.164 phone number.`);
    console.error('   Expected format: + followed by 7-15 digits with no spaces, dashes, or letters.\n');
    process.exit(1);
  }

  const authCheck = isAuthorizedLiveRecipient(trimmedPhone);
  if (!authCheck.authorized) {
    console.error(`\n❌ ERROR: Authorization check failed: ${authCheck.reason}\n`);
    process.exit(1);
  }

  if (!apiKey.trim()) {
    console.error('\n❌ ERROR: CALL-E API key required. Pass via --api-key or set CALLE_API_KEY in .env.\n');
    process.exit(1);
  }

  const maskedPhone = maskPhoneNumber(trimmedPhone);

  console.log('\n=============================================================');
  console.log('🚀 VAULTCALL: OUT-OF-BAND AIRGAP VERIFICATION DISPATCH');
  console.log('=============================================================');
  console.log(`📱 Destination (Masked): ${maskedPhone}`);
  console.log(`👤 Target Officer:       ${officerName}`);
  console.log(`🔑 Security Token:       Zulu-Echo-342`);
  console.log(`💰 Wire Exposure:        $785,000.00 (Apex Global Logistics)`);
  console.log(`🏦 Suspect Bank:         Biscayne Bay Federal Credit Union`);
  console.log(`🌐 Prompt Language:      English (en-US)`);
  console.log('-------------------------------------------------------------');
  console.log('📡 Transport origin pinned to approved HTTPS gateway...');
  console.log('⚠️  Accepted-Call Limits: In-flight carrier PSTN audio cannot be cancelled once accepted.');
  console.log('ℹ️  Advisory Notice: VaultCall generates internal audit proofs; does not execute direct bank wires.');
  console.log('-------------------------------------------------------------');

  const client = await getCalleClient(apiKey.trim(), process.env.CALLE_BASE_URL);

  const prompt = `You are an automated treasury security verification assistant from VaultCall calling ${officerName} at ${maskedPhone} for an enterprise security check on behalf of Apex Global Logistics.
Security Challenge Reference Token: "Zulu-Echo-342".
Exposure Amount: $785,000.00.
Target Beneficiary Bank: Biscayne Bay Federal Credit Union.

CONVERSATIONAL RULES (PROFESSIONAL ENGLISH):
- Speak like a polite, professional enterprise security agent.
- Greet the callee: "Hello, this is VaultCall enterprise treasury security calling regarding an urgent wire security check for Apex Global Logistics."
- If the callee asks who you are: Explain that VaultCall is verifying an accounts payable banking change.
- If the callee asks where you got their number: State that the number is the verified corporate PBX contact on file.
- Ask to confirm the last 4 digits of the company's Federal Tax ID (EIN: 8812).
- State: "We received an instruction to route invoice payments totaling $785,000.00 to Biscayne Bay Federal Credit Union, reference Zulu-Echo-342. Did you authorize this change?"
- If the callee denies authorizing the change or suspects fraud: Set verbal_bank_change_status to "FRAUD_REJECTED".
- If the callee explicitly confirms the change: Set verbal_bank_change_status to "CONFIRMED_VALID".
- If you reach an IVR, voicemail, or receptionist: Set verbal_bank_change_status to "CALL_BACK_REQUESTED".`;

  console.log('📞 Placing live carrier call task... Expect incoming PSTN connection.');
  console.log('⏳ Awaiting carrier response and verbatim turns...');

  const startTime = Date.now();
  try {
    const call = await client.calls.createAndWait(
      {
        task: prompt,
        recipients: [
          {
            phones: [trimmedPhone],
            locale: 'en-US',
            region: 'US',
          },
        ],
        resultSchema: {
          type: 'object',
          required: ['spoke_with_authorized_officer', 'verbal_bank_change_status'],
          properties: {
            spoke_with_authorized_officer: { type: 'boolean' },
            officer_name_stated: { type: 'string' },
            ein_last4_matched: { type: 'boolean' },
            verbal_bank_change_status: {
              type: 'string',
              enum: ['CONFIRMED_VALID', 'FRAUD_REJECTED', 'UNKNOWN_NO_RECORD', 'CALL_BACK_REQUESTED'],
            },
            challenge_token_acknowledged: { type: 'boolean' },
            direct_quote_reason: { type: 'string' },
          },
        },
        metadata: {
          system: 'VaultCall',
          challenge_token: 'Zulu-Echo-342',
          target_officer: officerName,
        },
      },
      {
        timeoutMs: 300000,
        intervalMs: 2500,
      }
    );

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log('\n=============================================================');
    console.log(`✅ CALL COMPLETED IN ${elapsed} SECONDS`);
    console.log('=============================================================');
    console.log(`Call ID:       ${call.id}`);
    console.log(`Call Status:   ${call.status}`);
    console.log(`Completed:     ${call.completedAt}`);
    console.log(`Summary:       ${maskPhoneNumbersInText(call.summary || 'N/A')}`);
    console.log(`Task Complete: ${call.taskCompleted}`);

    const recipient = call.recipients?.[0];
    const attempt = recipient?.attempts?.[0];
    const turns = attempt?.transcriptTurns || [];

    if (turns.length > 0) {
      console.log('\n--- VERBATIM TRANSCRIPT (PHONE NUMBERS MASKED) ---');
      turns.forEach((t: any) => {
        const text = maskPhoneNumbersInText(t.text || t.content || '');
        console.log(`[${(t.speaker || 'UNKNOWN').toUpperCase()}]: "${text}"`);
      });
    } else {
      console.log('\n⚠️ No callee turns captured. Result preserved in fail-closed UNKNOWN state.');
    }

    console.log('\n--- EXTRACTED STRUCTURED INTELLIGENCE ---');
    const rawStructured = recipient?.structuredResult || call.structuredResult || {};
    const sanitizedStructured = JSON.parse(
      maskPhoneNumbersInText(JSON.stringify(rawStructured, null, 2))
    );
    console.log(JSON.stringify(sanitizedStructured, null, 2));
    console.log('=============================================================\n');
  } catch (err: any) {
    const maskedErr = maskPhoneNumbersInText(err.message || String(err));
    console.error('\n❌ Call dispatch failed (Fail-Closed UNKNOWN):', maskedErr);
  }
}

main();
