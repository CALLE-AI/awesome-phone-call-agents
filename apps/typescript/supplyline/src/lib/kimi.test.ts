import { generateRecommendationSummary } from '../app/actions';

async function verifyKimi() {
  console.log('=== KIMI SUMMARIZATION VERIFICATION ===\n');

  const summary = await generateRecommendationSummary(
    'load-001',
    'carrier-a',
    1620,
    'carrier-b',
    1650,
    180,
    30,
    true
  );

  console.log('Generated summary:');
  console.log(summary);
  console.log('');

  if (typeof summary !== 'string' || summary.length === 0) {
    throw new Error('Summary must be a non-empty string');
  }

  console.log('✅ KIMI SUMMARIZATION VERIFICATION PASSED');
  console.log('Summary generation works end-to-end');
}

verifyKimi().catch((err) => {
  console.error('❌ KIMI SUMMARIZATION VERIFICATION FAILED:', err);
  process.exit(1);
});
