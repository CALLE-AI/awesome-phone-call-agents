import { mockCallCarriersForQuotes, mockNegotiateWithCarrier } from './calle';
import { compareRound1Quotes, determineFinalWinner } from './comparison';
import { initialLoads, initialCarriers } from './data';

async function runE2E() {
  console.log('=== SUPPLYLINE END-TO-END VERIFICATION ===\n');

  const load = initialLoads[0];
  const carriers = initialCarriers;

  // Phase 1: Source Carriers
  console.log('PHASE 1: Source Carriers');
  const r1Quotes = await mockCallCarriersForQuotes(load, carriers);
  r1Quotes.forEach((q) => {
    const carrier = carriers.find((c) => c.id === q.carrierId);
    console.log(`  ${carrier?.name}: $${q.quotedRate} (${q.available})`);
  });

  // Phase 2: Compare
  console.log('\nPHASE 2: Compare Quotes');
  const comparison = compareRound1Quotes(r1Quotes);
  console.log(`  Lowest: $${comparison.lowestQuote.quotedRate} (${comparison.lowestQuote.carrierId})`);
  console.log(`  Highest: $${comparison.highestQuote.quotedRate} (${comparison.highestQuote.carrierId})`);
  console.log(`  Gap: $${comparison.gap}`);
  console.log(`  Should negotiate: ${comparison.shouldNegotiate}`);

  if (!comparison.shouldNegotiate) {
    throw new Error('Should negotiate — gap is $150 > $50');
  }

  // Phase 3: Negotiate
  console.log('\nPHASE 3: Negotiate');
  const targetCarrier = carriers.find((c) => c.id === comparison.negotiationTarget!.carrierId)!;
  const r2Quote = await mockNegotiateWithCarrier(
    load,
    targetCarrier,
    comparison.lowestQuote.quotedRate!
  );
  console.log(`  ${targetCarrier.name} negotiated to: $${r2Quote.quotedRate}`);
  console.log(`  Evidence: ${r2Quote.evidence.substring(0, 60)}...`);

  // Phase 4: Final Recommendation
  console.log('\nPHASE 4: Final Recommendation');
  const finalResult = determineFinalWinner(r1Quotes, r2Quote);
  console.log(`  Winner: ${finalResult.winner.carrierId} at $${finalResult.winner.quotedRate}`);
  console.log(`  Savings vs original: $${finalResult.savingsVsOriginal}`);
  console.log(`  Savings vs next best: $${finalResult.savingsVsNextBest}`);
  console.log(`  Was negotiated: ${finalResult.wasNegotiated}`);

  // Phase 5: Assertions
  if (finalResult.winner.carrierId !== 'carrier-a') {
    throw new Error('Winner should be Rockridge (carrier-a)');
  }
  if (finalResult.winner.quotedRate !== 1620) {
    throw new Error(`Expected $1,620, got $${finalResult.winner.quotedRate}`);
  }
  if (finalResult.savingsVsOriginal !== 180) {
    throw new Error(`Expected $180 savings, got $${finalResult.savingsVsOriginal}`);
  }
  if (finalResult.savingsVsNextBest !== 30) {
    throw new Error(`Expected $30 savings, got $${finalResult.savingsVsNextBest}`);
  }
  if (!finalResult.wasNegotiated) {
    throw new Error('Should flag as negotiated');
  }

  console.log('\n✅ END-TO-END VERIFICATION PASSED');
  console.log('Full flow: Source → Compare → Negotiate → Recommend → Book');
  console.log('Rockridge negotiated from $1,800 → $1,620. $180 saved.');
}

runE2E().catch((err) => {
  console.error('❌ END-TO-END VERIFICATION FAILED:', err);
  process.exit(1);
});
