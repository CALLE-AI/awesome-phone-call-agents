import { existsSync } from 'node:fs';
import { liveReadiness } from '../server/readiness';
if (existsSync('.env')) process.loadEnvFile('.env');
const report = liveReadiness();
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(
    `ReadyCheck live setup: ${report.ready ? 'configuration ready' : 'setup incomplete'}`,
  );
  for (const check of report.checks)
    console.log(`${check.passed ? 'PASS' : 'TODO'} ${check.id}: ${check.detail}`);
  console.log(report.nextStep);
  console.log('No network requests or phone calls were made.');
}
if (!report.ready) process.exitCode = 1;
