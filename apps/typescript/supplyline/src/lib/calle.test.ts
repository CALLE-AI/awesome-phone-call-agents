// Build-time verification: test the mock function with demo data
import { mockCallCarriersForQuotes } from './calle';
import { initialLoads, initialCarriers } from './data';

async function verifyMockFlow() {
  const load = initialLoads[0];
  const carriers = initialCarriers;

  const quotes = await mockCallCarriersForQuotes(load, carriers);

  console.log('=== MOCK ROUND 1 VERIFICATION ===');
  console.log(`Load: ${load.origin} → ${load.destination}`);
  console.log(`Carriers called: ${carriers.length}`);

  quotes.forEach((q) => {
    const carrier = carriers.find((c) => c.id === q.carrierId);
    console.log(`\n${carrier?.name}:`);
    console.log(`  Rate: $${q.quotedRate}`);
    console.log(`  Available: ${q.available}`);
    console.log(`  Evidence: ${q.evidence.substring(0, 80)}...`);
  });

  const rockridge = quotes.find((q) => q.carrierId === 'carrier-a');
  const prairie = quotes.find((q) => q.carrierId === 'carrier-b');

  if (rockridge?.quotedRate !== 1800) {
    throw new Error(`Expected Rockridge rate 1800, got ${rockridge?.quotedRate}`);
  }
  if (prairie?.quotedRate !== 1650) {
    throw new Error(`Expected Prairie Line rate 1650, got ${prairie?.quotedRate}`);
  }

  console.log('\n✅ ALL MOCK DATA VERIFICATION PASSED');
  console.log('Rockridge: $1,800 (above market — worth negotiating)');
  console.log('Prairie Line: $1,650 (near market average)');
}

verifyMockFlow().catch((err) => {
  console.error('❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
