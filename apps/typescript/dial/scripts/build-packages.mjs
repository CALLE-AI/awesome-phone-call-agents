import { execSync } from 'node:child_process';

/**
 * Builds workspace packages in dependency order. tsc project references would
 * also work, but an explicit list keeps the ordering obvious and the failure
 * message pointed at the package that actually broke.
 */
const ORDER = [
  '@dial/config',
  '@dial/schemas',
  '@dial/observability',
  '@dial/domain',
  '@dial/database',
  '@dial/search',
  '@dial/ai',
  '@dial/calle',
  '@dial/orchestrator',
  '@dial/api-client',
  '@dial/ui',
];

for (const pkg of ORDER) {
  process.stdout.write(`building ${pkg} ... `);
  try {
    execSync(`npm run build -w ${pkg} --if-present`, { stdio: 'pipe' });
    process.stdout.write('ok\n');
  } catch (error) {
    process.stdout.write('FAILED\n');
    process.stderr.write(String(error.stdout ?? '') + String(error.stderr ?? ''));
    process.exit(1);
  }
}
console.log('all packages built');
