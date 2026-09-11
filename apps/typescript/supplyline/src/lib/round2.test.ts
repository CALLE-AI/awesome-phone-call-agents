import { negotiateWithCarrier } from '../app/actions';
import { compareRound1Quotes } from './comparison';
import { mockCallCarriersForQuotes } from './calle';
import { initialLoads, initialCarriers } from './data';

async function verifyRound2() {
  console.log('=== ROUND 2 MOCK VERIFICATION ===\n');

  const load = initialLoads[0];
  const carriers = initialCarriers;

  // Step 1: Get round 1 quotes
  const r1Quotes = await mockCallCarriersForQuotes(load, carriers);
  console.log('Round 1 quotes:');
  r1Quotes.forEach((q) => {
    const carrier = carriers.find((c) => c.id === q.carrierId);
    console.log(`  ${carrier?.name}: $${q.quotedRate}`);
  });

  // Step 2: Compare and identify target
  const comparison = compareRound1Quotes(r1Quotes);
  console.log(`\nComparison:`);
  console.log(`  Lowest: $${comparison.lowestQuote.quotedRate}`);
  console.log(`  Highest: $${comparison.highestQuote.quotedRate}`);
  console.log(`  Gap: $${comparison.gap}`);
  console.log(`  Should negotiate: ${comparison.shouldNegotiate}`);
  console.log(`  Target: ${comparison.negotiationTarget?.carrierId}`);

  if (!comparison.shouldNegotiate) throw new Error('Should negotiate');

  // Step 3: Call server action for round 2 (mock mode)
  const targetId = comparison.negotiationTarget!.carrierId;
  const competingRate = comparison.lowestQuote.quotedRate!;
  const r2Quote = await negotiateWithCarrier(load.id, targetId, competingRate);

  console.log(`\nRound 2 result:`);
  console.log(`  Carrier: ${targetId}`);
  console.log(`  Negotiated rate: $${r2Quote.quotedRate}`);
  console.log(`  Evidence: ${r2Quote.evidence.substring(0, 100)}...`);

  if (r2Quote.quotedRate !== 1620) {
    throw new Error(`Expected $1,620, got $${r2Quote.quotedRate}`);
  }

  console.log('\n✅ ROUND 2 VERIFICATION PASSED');
  console.log('Rockridge negotiated from $1,800 down to $1,620');
}

verifyRound2().catch((err) => {
  console.error('❌ ROUND 2 VERIFICATION FAILED:', err);
  process.exit(1);
});
