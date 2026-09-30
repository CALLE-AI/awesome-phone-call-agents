import { compareRound1Quotes, determineFinalWinner, NEGOTIATION_THRESHOLD } from './comparison';
import { Quote } from './types';

function createMockQuote(carrierId: string, rate: number, round: 1 | 2): Quote {
  return {
    id: `quote-test-${carrierId}-r${round}`,
    loadId: 'load-001',
    carrierId,
    round,
    available: 'yes',
    quotedRate: rate,
    pickupConfirmed: 'yes',
    evidence: 'Mock evidence',
    transcript: 'Mock transcript',
    timestamp: new Date().toISOString(),
  };
}

function verify() {
  console.log('=== DETERMINISTIC COMPARISON VERIFICATION ===\n');

  // Test 1: Round 1 comparison
  const rockridge = createMockQuote('carrier-a', 1800, 1);
  const prairie = createMockQuote('carrier-b', 1650, 1);
  const r1Comparison = compareRound1Quotes([rockridge, prairie]);

  console.log('Test 1: Round 1 comparison');
  console.log(`  Lowest: ${r1Comparison.lowestQuote.carrierId} at $${r1Comparison.lowestQuote.quotedRate}`);
  console.log(`  Highest: ${r1Comparison.highestQuote.carrierId} at $${r1Comparison.highestQuote.quotedRate}`);
  console.log(`  Gap: $${r1Comparison.gap}`);
  console.log(`  Threshold: $${NEGOTIATION_THRESHOLD}`);
  console.log(`  Should negotiate: ${r1Comparison.shouldNegotiate}`);
  console.log(`  Target: ${r1Comparison.negotiationTarget?.carrierId}`);

  if (!r1Comparison.shouldNegotiate) throw new Error('Should negotiate — gap is $150 > $50');
  if (r1Comparison.negotiationTarget?.carrierId !== 'carrier-a') throw new Error('Should target carrier-a');

  // Test 2: Final winner determination
  const negotiated = createMockQuote('carrier-a', 1620, 2);
  const finalResult = determineFinalWinner([rockridge, prairie], negotiated);

  console.log('\nTest 2: Final winner determination');
  console.log(`  Winner: ${finalResult.winner.carrierId} at $${finalResult.winner.quotedRate}`);
  console.log(`  Runner-up: ${finalResult.runnerUp.carrierId} at $${finalResult.runnerUp.quotedRate}`);
  console.log(`  Savings vs original: $${finalResult.savingsVsOriginal}`);
  console.log(`  Savings vs next best: $${finalResult.savingsVsNextBest}`);
  console.log(`  Was negotiated: ${finalResult.wasNegotiated}`);

  if (finalResult.winner.carrierId !== 'carrier-a') throw new Error('Winner should be carrier-a');
  if (finalResult.savingsVsOriginal !== 180) throw new Error(`Expected $180 savings, got $${finalResult.savingsVsOriginal}`);
  if (finalResult.savingsVsNextBest !== 30) throw new Error(`Expected $30 savings, got $${finalResult.savingsVsNextBest}`);
  if (!finalResult.wasNegotiated) throw new Error('Should flag as negotiated');

  // Test 3: Fallback — no negotiation if gap is too small
  const closeQuote1 = createMockQuote('carrier-a', 1660, 1);
  const closeQuote2 = createMockQuote('carrier-b', 1650, 1);
  const closeComparison = compareRound1Quotes([closeQuote1, closeQuote2]);

  console.log('\nTest 3: Small gap (no negotiation)');
  console.log(`  Gap: $${closeComparison.gap}`);
  console.log(`  Should negotiate: ${closeComparison.shouldNegotiate}`);

  if (closeComparison.shouldNegotiate) throw new Error('Should NOT negotiate — gap is $10 < $50');

  console.log('\n✅ ALL COMPARISON LOGIC VERIFICATION PASSED');
}

verify();
