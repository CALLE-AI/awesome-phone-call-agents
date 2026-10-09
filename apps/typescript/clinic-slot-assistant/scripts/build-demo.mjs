import { spawnSync } from 'node:child_process';

// Cross-platform public build. The flag is baked into both server and client.
const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
  stdio: 'inherit', env: {...process.env, CLINIC_PUBLIC_DEMO: 'true'},
});
process.exit(result.status ?? 1);
