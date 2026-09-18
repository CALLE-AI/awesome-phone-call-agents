/**
 * Places ONE real CALL-E call to verify the integration end to end.
 * Costs roughly $0.05 and one of the free-tier calls. Run deliberately:
 *
 *   node test-live-call.js +447700900123
 */
process.env.DRY_RUN = 'false';
const calle = require('./adapters/calle');

const phone = process.argv[2];
if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
  console.error('Usage: node test-live-call.js +34XXXXXXXXX  (E.164 format)');
  process.exit(1);
}

(async () => {
  console.log(`Placing ONE real call to ${calle.maskPhone(phone)}. This spends credit.\n`);

  const call = await calle.createCall({
    task: calle.wakeUpQuestionTask(phone, 'What is five plus three?', 'eight', 'there'),
    phone,
    resultSchema: calle.WAKE_RESULT_SCHEMA,
    metadata: { purpose: 'wake', idempotency_key: `livetest_${Date.now()}` },
  });

  console.log('Created:', JSON.stringify(call, null, 2).slice(0, 900));
  console.log('\nPolling for the result (up to 4 minutes)…');

  const { getCalleConfig } = require('./lib/secrets');
  const { apiKey, baseUrl } = await getCalleConfig();

  for (let i = 0; i < 48; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(`${baseUrl}/v1/calls/${call.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json();
    process.stdout.write(`  ${data.status}\r`);
    if (['completed', 'failed', 'canceled'].includes(data.status)) {
      console.log(`\n\nFinal status: ${data.status}`);
      console.log('structured_result:', JSON.stringify(data.structured_result, null, 2));
      console.log('task_completed:', data.task_completed);
      console.log('confidence:', JSON.stringify(data.completion_confidence));
      const turns = data.recipients?.[0]?.attempts?.[0]?.transcript_turns || [];
      console.log(`\nTranscript (${turns.length} turns):`);
      for (const t of turns) console.log(`  [${t.offset_seconds}s] ${t.speaker}: ${t.text}`);
      if (data.failure_code) console.log('failure:', data.failure_code, data.failure_message);
      return;
    }
  }
  console.log('\nTimed out waiting. Check the dashboard.');
})().catch(e => { console.error('\nERROR:', e.message, e.body ? JSON.stringify(e.body) : ''); process.exit(1); });
