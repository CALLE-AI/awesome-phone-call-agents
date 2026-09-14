import { CalleClient } from '@call-e/calle';
import dotenv from 'dotenv';
import path from 'node:path';
import { isDestinationAuthorized, maskPhoneNumber } from './utils/phone.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const apiKey = process.env.CALLE_API_KEY || process.env.CALL_E_API_KEY;
if (!apiKey) {
  console.error('Error: CALLE_API_KEY is not configured in your environment.');
  process.exit(1);
}

const targetPhone = process.argv[2] || process.env.TARGET_PHONE_NUMBER;
if (!targetPhone) {
  console.error('Usage: npm run tsx src/live_runner.ts <E.164-phone-number> (or set TARGET_PHONE_NUMBER in .env)');
  process.exit(1);
}

const authCheck = isDestinationAuthorized(targetPhone, 'LIVE');
if (!authCheck.authorized) {
  console.error(`Destination authorization failed: ${authCheck.reason}`);
  process.exit(1);
}

const client = new CalleClient({ apiKey });

async function monitor() {
  const maskedPhone = maskPhoneNumber(authCheck.formatted);
  console.log(`--- INITIATING LIVE CALL VIA CALL-E TO ${maskedPhone} ---`);

  const call = await client.calls.create({
    task: 'You are TRACE autonomous verification agent. Speak clearly in English. Greet the person politely and confirm if they can hear you.',
    recipients: [
      {
        phones: [authCheck.formatted],
        phone: authCheck.formatted,
        region: authCheck.formatted.startsWith('+91') ? 'IN' : undefined,
      },
    ],
    metadata: {
      system: 'TRACE_LIVE_VERIFICATION',
    },
  });

  console.log(`Call created with ID: ${call.id}`);
  console.log(`Status: queued / dialing phone ${maskedPhone} ...`);

  // Poll for up to 60 seconds
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const status = await client.calls.get(call.id);
    const recipient = status.recipients?.[0];
    const attempt = recipient?.attempts?.[0];
    console.log(`[T+${(i + 1) * 3}s] Status: ${status.status} | Recipient: ${recipient?.status} | Attempt: ${attempt?.status || 'none'}`);

    if (attempt?.transcriptTurns && attempt.transcriptTurns.length > 0) {
      console.log('--- TRANSCRIPT TURNS RECEIVED ---');
      attempt.transcriptTurns.forEach((t: any) => console.log(`[${t.speaker || t.role || 'UNKNOWN'}] ${t.text}`));
    }

    if (status.status === 'completed' || status.status === 'failed') {
      console.log('Final Call Outcome:', status.status);
      if (status.failureMessage) console.log('Failure Message:', status.failureMessage);
      if (status.summary) console.log('Summary:', status.summary);
      break;
    }
  }
}

monitor().catch(console.error);
