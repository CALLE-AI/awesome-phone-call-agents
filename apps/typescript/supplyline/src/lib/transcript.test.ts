import { mockCallCarriersForQuotes, mockNegotiateWithCarrier } from './calle';
import { compareRound1Quotes } from './comparison';
import { initialLoads, initialCarriers } from './data';

async function verifyTranscripts() {
  console.log('=== TRANSCRIPT VIEW VERIFICATION ===\n');

  const load = initialLoads[0];
  const carriers = initialCarriers;

  // Step 1: Round 1 quotes (with transcripts)
  const r1Quotes = await mockCallCarriersForQuotes(load, carriers);
  console.log('Round 1 transcripts:');
  r1Quotes.forEach((q) => {
    const carrier = carriers.find((c) => c.id === q.carrierId);
    console.log(`\n${carrier?.name} (Round ${q.round}):`);
    console.log(`  Transcript: ${q.transcript.substring(0, 80)}...`);
    console.log(`  Evidence: ${q.evidence.substring(0, 80)}...`);
    console.log(`  Rate: $${q.quotedRate}`);
  });

  // Step 2: Round 2 quote (with transcript)
  const comparison = compareRound1Quotes(r1Quotes);
  const r2Quote = await mockNegotiateWithCarrier(
    load,
    carriers.find((c) => c.id === comparison.negotiationTarget!.carrierId)!,
    comparison.lowestQuote.quotedRate!
  );

  console.log(`\n${carriers.find((c) => c.id === r2Quote.carrierId)?.name} (Round ${r2Quote.round}):`);
  console.log(`  Transcript: ${r2Quote.transcript.substring(0, 80)}...`);
  console.log(`  Evidence: ${r2Quote.evidence.substring(0, 80)}...`);
  console.log(`  Rate: $${r2Quote.quotedRate}`);

  // Verify transcripts exist and contain expected content
  const rockridgeR1 = r1Quotes.find((q) => q.carrierId === 'carrier-a');
  const prairieR1 = r1Quotes.find((q) => q.carrierId === 'carrier-b');

  if (!rockridgeR1?.transcript.includes('Rockridge')) {
    throw new Error('Rockridge R1 transcript missing carrier name');
  }
  if (!prairieR1?.transcript.includes('Prairie')) {
    throw new Error('Prairie Line R1 transcript missing carrier name');
  }
  if (!r2Quote.transcript.includes('tight for us')) {
    throw new Error('R2 transcript missing negotiation friction');
  }

  console.log('\n✅ TRANSCRIPT VIEW VERIFICATION PASSED');
  console.log('All transcripts contain expected content');
}

verifyTranscripts().catch((err) => {
  console.error('❌ TRANSCRIPT VIEW VERIFICATION FAILED:', err);
  process.exit(1);
});
