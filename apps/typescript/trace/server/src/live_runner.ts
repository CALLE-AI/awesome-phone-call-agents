import { CalleClient } from '@call-e/calle';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const apiKey = process.env.CALLE_API_KEY || process.env.CALL_E_API_KEY;

const client = new CalleClient({ apiKey: apiKey! });

async function monitor() {
  console.log('--- INITIATING LIVE CALL VIA CALL-E NOW ---');
  const call = await client.calls.create({
    task: 'You are TRACE autonomous verification agent. Speak clearly in English/Hindi. Greet the person politely and confirm if they can hear you.',
    recipients: [
      {
        phones: ['+919623498766'],
        phone: '+919623498766',
        region: 'IN'
      }
    ],
    metadata: {
      system: 'TRACE_LIVE_VERIFICATION'
    }
  });

  console.log(`Call created with ID: ${call.id}`);
  console.log('Status: queued / dialing phone +919623498766 ...');

  // Poll for up to 60 seconds
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const status = await client.calls.get(call.id);
    const recipient = status.recipients?.[0];
    const attempt = recipient?.attempts?.[0];
    console.log(`[T+${(i+1)*3}s] Status: ${status.status} | Recipient: ${recipient?.status} | Attempt: ${attempt?.status || 'none'}`);
    
    if (attempt?.transcriptTurns && attempt.transcriptTurns.length > 0) {
      console.log('--- TRANSCRIPT TURNS RECEIVED ---');
      attempt.transcriptTurns.forEach((t) => console.log(`[${t.speaker}] ${t.text}`));
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
