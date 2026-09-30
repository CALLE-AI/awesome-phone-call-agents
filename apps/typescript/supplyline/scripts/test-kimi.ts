import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Call the REAL function from src/lib/kimi.ts — do not reimplement it
import { generateSummary } from '../src/lib/kimi';

// Load .env.local manually (no dotenv dependency in this project)
function loadEnvFile(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch (err) {
    console.error(`Failed to read ${file}:`, err);
  }
  return env;
}

async function main() {
  const env = loadEnvFile(resolve(process.cwd(), '.env.local'));
  const apiKey = env.KIMI_API_KEY;

  if (!apiKey || apiKey === 'your_kimi_api_key_here') {
    console.error('No real KIMI_API_KEY found in .env.local (missing or placeholder).');
    process.exit(1);
  }

  console.log(`KIMI_API_KEY present. Length: ${apiKey.length} | Starts with: ${apiKey.slice(0, 4)}`);

  // generateSummary reads process.env.KIMI_API_KEY at call time
  process.env.KIMI_API_KEY = apiKey;

  // Detect whether the REAL Kimi call failed and fell back to the local summary
  let apiFailed = false;
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    if (msg.includes('using local fallback')) apiFailed = true;
    originalError(...args);
  };

  // Realistic params from an actual completed negotiation (Rockridge, negotiated $1,650)
  const params = {
    loadOrigin: 'Chicago, IL',
    loadDestination: 'Atlanta, GA',
    equipmentType: 'Dry Van',
    weight: 43000,
    pickupDate: '2026-09-01',
    winnerName: 'Rockridge Transport LLC',
    winnerRate: 1650,
    runnerUpName: 'Prairie Line Carriers',
    runnerUpRate: 1700,
    savingsVsOriginal: 150,
    savingsVsNextBest: 50,
    wasNegotiated: true,
  };

  const prompt = `Summarize this completed load negotiation for the operations team:
${params.equipmentType} load from ${params.loadOrigin} to ${params.loadDestination}, ${params.weight.toLocaleString()} lbs, pickup ${params.pickupDate}.
${params.winnerName} was negotiated down to $${params.winnerRate.toLocaleString()} (from an original quote that was $${params.savingsVsOriginal.toLocaleString()} higher).
The next best offer was ${params.runnerUpName} at $${params.runnerUpRate.toLocaleString()}, so we saved $${params.savingsVsNextBest.toLocaleString()} vs the next best.
Recommend the winner concisely with the key numbers.`;

  console.log('\nCalling generateSummary() (real Kimi API)...\n');

  const summary = await generateSummary(prompt, params);
  console.error = originalError;

  console.log(`Path taken: ${apiFailed ? 'LOCAL FALLBACK (Kimi API call failed)' : 'REAL KIMI API (success)'}`);
  console.log('\n--- Summary text returned ---');
  console.log(summary);
  console.log('-----------------------------');

  if (apiFailed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unexpected script error:', err);
  process.exit(1);
});
