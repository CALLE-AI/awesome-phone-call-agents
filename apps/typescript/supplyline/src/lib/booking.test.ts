import { createBooking } from '../app/actions';
import { determineFinalWinner } from './comparison';
import { mockCallCarriersForQuotes, mockNegotiateWithCarrier } from './calle';
import { initialLoads, initialCarriers } from './data';

async function verifyBooking() {
  console.log('=== BOOKING FLOW VERIFICATION ===\n');

  const load = initialLoads[0];
  const carriers = initialCarriers;

  // Step 1: Round 1 quotes
  const r1Quotes = await mockCallCarriersForQuotes(load, carriers);
  console.log('Round 1 quotes:');
  r1Quotes.forEach((q) => {
    const carrier = carriers.find((c) => c.id === q.carrierId);
    console.log(`  ${carrier?.name}: $${q.quotedRate}`);
  });

  // Step 2: Round 2 negotiation
  const comparison = {
    lowestQuote: r1Quotes.find((q) => q.carrierId === 'carrier-b')!,
    highestQuote: r1Quotes.find((q) => q.carrierId === 'carrier-a')!,
    gap: 150,
    shouldNegotiate: true,
    negotiationTarget: r1Quotes.find((q) => q.carrierId === 'carrier-a')!,
  };

  const r2Quote = await mockNegotiateWithCarrier(
    load,
    carriers.find((c) => c.id === 'carrier-a')!,
    comparison.lowestQuote.quotedRate!
  );
  console.log(`\nRound 2: Rockridge negotiated to $${r2Quote.quotedRate}`);

  // Step 3: Final winner
  const finalResult = determineFinalWinner(r1Quotes, r2Quote);
  console.log(`\nFinal winner: ${finalResult.winner.carrierId} at $${finalResult.winner.quotedRate}`);
  console.log(`Savings vs original: $${finalResult.savingsVsOriginal}`);
  console.log(`Savings vs next best: $${finalResult.savingsVsNextBest}`);

  // Step 4: Create booking
  const booking = await createBooking(
    load.id,
    finalResult.winner.id,
    finalResult.winner.quotedRate!,
    finalResult.savingsVsOriginal,
    finalResult.savingsVsNextBest
  );

  console.log('\nBooking created:');
  console.log(`  ID: ${booking.id}`);
  console.log(`  Load: ${booking.loadId}`);
  console.log(`  Winning quote: ${booking.winningQuoteId}`);
  console.log(`  Final rate: $${booking.finalRate}`);
  console.log(`  Savings vs original: $${booking.savingsVsOriginal}`);
  console.log(`  Savings vs next best: $${booking.savingsVsNextBest}`);
  console.log(`  Timestamp: ${booking.timestamp}`);

  if (booking.finalRate !== 1620) {
    throw new Error(`Expected final rate $1,620, got $${booking.finalRate}`);
  }
  if (booking.savingsVsOriginal !== 180) {
    throw new Error(`Expected $180 savings, got $${booking.savingsVsOriginal}`);
  }
  if (booking.savingsVsNextBest !== 30) {
    throw new Error(`Expected $30 savings, got $${booking.savingsVsNextBest}`);
  }

  console.log('\n✅ BOOKING FLOW VERIFICATION PASSED');
  console.log('Load can be booked with correct savings calculations');
}

verifyBooking().catch((err) => {
  console.error('❌ BOOKING FLOW VERIFICATION FAILED:', err);
  process.exit(1);
});
