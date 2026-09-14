/**
 * VaultCall Live Outbound Phone Call Utility
 * Uses official @call-e/calle SDK to place a real, dynamic, human-level PSTN phone call.
 *
 * Target: Corporate Officer / Financial Controller
 * Handles unscripted human behavior, pushbacks ("who are you?", "how did you get my number?"),
 * hold/wait requests, and multilingual Hindi/English conversation.
 *
 * Usage:
 *   npx tsx scripts/make-live-call.ts --phone "+1XXXXXXXXXX" --name "Michael Vance"
 */

async function getCalleClient(apiKey: string, baseUrl?: string) {
  const mod = await import('@call-e/calle');
  return new mod.CalleClient({
    apiKey,
    baseUrl: baseUrl || 'https://api.heycall-e.com',
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

  if (!phone) {
    console.error('\n❌ ERROR: Target phone number is required in E.164 format (e.g. +1XXXXXXXXXX or +91XXXXXXXXXX).');
    console.error('👉 Usage: npx tsx scripts/make-live-call.ts --phone "+1XXXXXXXXXX" --name "Controller Name"\n');
    process.exit(1);
  }

  if (!apiKey) {
    console.error('\n❌ ERROR: CALL-E API key required. Pass via --api-key or set CALLE_API_KEY in .env.');
    process.exit(1);
  }

  console.log('\n=============================================================');
  console.log('🚀 VAULTCALL: INITIATING REAL DYNAMIC OUT-OF-BAND CALL');
  console.log('=============================================================');
  console.log(`📱 Target Mobile Phone: ${phone}`);
  console.log(`👤 Target Officer:      ${officerName}`);
  console.log(`🔑 Security Token:      Zulu-Echo-342`);
  console.log(`💰 Wire Exposure:       $785,000.00 (Apex Global Logistics)`);
  console.log(`🏦 Suspect Bank:        Biscayne Bay Federal Credit Union`);
  console.log(`🌐 Language:            Multilingual (Hindi / English dynamic)`);
  console.log('-------------------------------------------------------------');
  console.log('📡 Connecting to official CALL-E Carrier API (https://api.heycall-e.com)...');

  const client = await getCalleClient(apiKey, process.env.CALLE_BASE_URL);

  const isIndianNumber = phone.startsWith('+91');
  const locale = isIndianNumber ? 'hi-IN' : 'en-US';
  const region = isIndianNumber ? 'IN' : 'US';

  const prompt = `You are an intelligent, polite, and natural AI security verification assistant from VaultCall calling ${officerName} at ${phone} for an enterprise security check on behalf of Apex Global Logistics.
Reference Token: "Zulu-Echo-342".
Exposure: $785,000.00 wire redirection to Biscayne Bay Federal Credit Union.

CONVERSATIONAL RULES (NATURAL, FLUENT, UN-SCRIPTED):
- Speak like a polite, intelligent human professional. If the callee speaks Hindi, converse in natural, polite Hindi/Hinglish. If in English, converse fluently in English.
- Greet the officer respectfully: "Hello, this is VaultCall enterprise security verification system connecting regarding an urgent security check for Apex Global Logistics." (Or in Hindi: "Namaste, main VaultCall enterprise security system se baat kar raha hoon.")
- DO NOT say rigid automated robotic responses like "Sorry, I don't have that information". Always address questions intelligently and patiently.

HOW TO ANSWER UNPREDICTABLE CALLEE QUESTIONS NATURALLY:
1. If asked who you are or where you are calling from:
   Explain: "I am calling from the VaultCall automated treasury security platform. We verify high-value account redirection requests before funds are released."
2. If asked where you got their number:
   Explain: "Your direct line is registered in the corporate treasury emergency directory for out-of-band identity verification to prevent email compromise fraud."
3. If asked what information is needed:
   Explain: "We received an invoice update requesting to divert a $785,000 payment to a new bank account at Biscayne Bay Federal Credit Union under security token Zulu-Echo-342. Did your organization authorize this change?"
4. If asked to hold or wait:
   Say: "Certainly, please take your time. I am on hold on the line." Wait patiently until they return.
5. If callee denies authorizing it, calls it a scam, or requests to stop it:
   Acknowledge immediately: "Understood. The wire payment has been immediately frozen and blocked to prevent any loss of capital. A security incident report has been logged." Set verbal_bank_change_status: "FRAUD_INTERCEPTED".
6. If callee explicitly confirms it is legitimate:
   Acknowledge: "Thank you. Verbal authorization is recorded under token Zulu-Echo-342." Set verbal_bank_change_status: "CONFIRMED_VALID".
7. If callee is suspicious or asks doubts:
   Stay calm, empathetic, and respectful. Focus on corporate treasury protection without hallucinating fake policies.`;

  console.log('📞 Placing live outbound call task... YOUR PHONE WILL RING SHORTLY!');
  console.log('⏳ Waiting for call completion (answer your phone and speak to CALL-E)...');

  const startTime = Date.now();
  try {
    const call = await client.calls.createAndWait(
      {
        task: prompt,
        recipients: [
          {
            phones: [phone],
            locale: locale,
            region: region,
          },
        ],
        resultSchema: {
          type: 'object',
          required: ['spoke_with_authorized_officer', 'verbal_bank_change_status'],
          properties: {
            spoke_with_authorized_officer: { type: 'boolean' },
            officer_name_stated: { type: 'string' },
            verbal_bank_change_status: {
              type: 'string',
              enum: ['CONFIRMED_VALID', 'FRAUD_INTERCEPTED', 'GATEKEEPER_HOLD'],
            },
            direct_quote_reason: { type: 'string' },
            call_notes_and_questions_asked: { type: 'string' },
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
    console.log(`✅ CALL COMPLETED IN ${elapsed} SECONDS!`);
    console.log('=============================================================');
    console.log(`Call ID:       ${call.id}`);
    console.log(`Call Status:   ${call.status}`);
    console.log(`Completed:     ${call.completedAt}`);
    console.log(`Summary:       ${call.summary || 'N/A'}`);
    console.log(`Task Complete: ${call.taskCompleted}`);

    const recipient = call.recipients?.[0];
    const attempt = recipient?.attempts?.[0];
    const turns = attempt?.transcriptTurns || [];

    if (turns.length > 0) {
      console.log('\n--- VERBATIM TRANSCRIPT OF YOUR CALL ---');
      turns.forEach((t: any) => {
        console.log(`[${(t.speaker || 'UNKNOWN').toUpperCase()}]: "${t.text || t.content}"`);
      });
    }

    console.log('\n--- STRUCTURED INTELLIGENCE VERDICT ---');
    console.log(JSON.stringify(recipient?.structuredResult || call.structuredResult, null, 2));
    console.log('=============================================================\n');
  } catch (err: any) {
    console.error('\n❌ Call dispatch failed:', err.message || err);
  }
}

main();
