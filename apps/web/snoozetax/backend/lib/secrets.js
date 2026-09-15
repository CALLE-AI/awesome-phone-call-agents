/**
 * Runtime secret loading from AWS SSM Parameter Store.
 *
 * Secrets are never written to disk and never committed. The parameter value is
 * a whole .env file body (KEY=value lines).
 *
 * Point this at your own AWS account with SSM_PROFILE, SSM_REGION and
 * SSM_PREFIX. This path is entirely optional: setting CALLE_API_KEY directly
 * skips SSM, and DRY_RUN (the default) needs no credentials at all.
 */
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const SSM_PROFILE = process.env.SSM_PROFILE || 'default';
const SSM_REGION = process.env.SSM_REGION || 'eu-west-1';
const SSM_PREFIX = process.env.SSM_PREFIX || '/calle/secrets';

const cache = new Map();

function parseEnvBody(raw) {
  const out = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    out[key] = value;
  }
  return out;
}

/**
 * Load one .env-shaped SecureString parameter from SSM, cached per process.
 * @param {string} envFile e.g. 'calle.env'
 * @returns {Promise<Record<string,string>>}
 */
async function loadSecrets(envFile) {
  if (cache.has(envFile)) return cache.get(envFile);

  const { stdout } = await execFileAsync('aws', [
    'ssm', 'get-parameter',
    '--name', `${SSM_PREFIX}/${envFile}`,
    '--with-decryption',
    '--profile', SSM_PROFILE,
    '--region', SSM_REGION,
    '--query', 'Parameter.Value',
    '--output', 'text',
  ], { timeout: 20000 });

  const parsed = parseEnvBody(stdout);
  cache.set(envFile, parsed);
  return parsed;
}

/**
 * Resolve CALL-E config. Environment variables win so that CI and the
 * dry-run path work with no AWS access at all.
 */
async function getCalleConfig() {
  if (process.env.CALLE_API_KEY) {
    return {
      apiKey: process.env.CALLE_API_KEY,
      baseUrl: process.env.CALLE_BASE_URL || 'https://api.heycall-e.com',
    };
  }
  try {
    const s = await loadSecrets('calle.env');
    return {
      apiKey: s.CALLE_API_KEY,
      baseUrl: s.CALLE_BASE_URL || 'https://api.heycall-e.com',
    };
  } catch {
    return { apiKey: null, baseUrl: 'https://api.heycall-e.com' };
  }
}

/**
 * The key that guards the read-only prompt inspector. Returns null when no key
 * is configured, and the route treats that as "closed", never as "open": a
 * missing secret must not silently publish the prompt library.
 */
async function getAdminKey() {
  if (process.env.SNOOZETAX_ADMIN_KEY) return process.env.SNOOZETAX_ADMIN_KEY;
  try {
    const s = await loadSecrets('calle.env');
    return s.SNOOZETAX_ADMIN_KEY || null;
  } catch {
    return null;
  }
}

module.exports = { loadSecrets, getCalleConfig, getAdminKey };
