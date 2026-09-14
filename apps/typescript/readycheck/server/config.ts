import { z } from 'zod';
import { isTimeZone } from '../src/domain/time';
import type { User } from './auth';
const recipientSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
    name: z.string().min(1).max(100),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    consentRef: z.string().min(3),
    timezone: z.string().refine(isTimeZone),
  })
  .strict();
export type Recipient = z.infer<typeof recipientSchema>;
export interface Config {
  apiKey: string;
  enabled: boolean;
  recipients: Recipient[];
  users: string[];
  maxPerDay: number;
  maxPerUserDay: number;
  callStart: number;
  callEnd: number;
  retentionDays: number;
  configError?: string;
  verificationCallId?: string;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const errors: string[] = [];
  function integer(name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      errors.push(`${name} must be a whole number between ${min} and ${max}.`);
      return fallback;
    }
    return value;
  }
  let recipients: Recipient[] = [],
    configError: string | undefined;
  try {
    recipients = z
      .array(recipientSchema)
      .max(20)
      .parse(JSON.parse(env.TEST_RECIPIENTS_JSON || '[]'));
    if (
      new Set(recipients.map((r) => r.id)).size !== recipients.length ||
      new Set(recipients.map((r) => r.phone)).size !== recipients.length
    )
      throw Error();
  } catch {
    configError = 'Test recipient configuration is invalid.';
  }
  const maxPerDay = integer('MAX_CALLS_PER_DAY', 10);
  const maxPerUserDay = integer('MAX_CALLS_PER_USER_DAY', 3);
  const callStart = integer('CALL_WINDOW_START', 9, 0, 23);
  const callEnd = integer('CALL_WINDOW_END', 20, 1, 24);
  const retentionDays = integer('TRANSCRIPT_RETENTION_DAYS', 30);
  if (callStart >= callEnd)
    errors.push('Calling hours must start before they end on the same local day.');
  if (env.LIVE_CALLS_ENABLED && !['true', 'false'].includes(env.LIVE_CALLS_ENABLED))
    errors.push('LIVE_CALLS_ENABLED must be true or false.');
  if (configError) errors.push(configError);
  return {
    apiKey: (env.CALLE_API_KEY || '').trim(),
    enabled: env.LIVE_CALLS_ENABLED === 'true',
    recipients,
    users: (env.LIVE_USER_IDS || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    maxPerDay,
    maxPerUserDay,
    callStart,
    callEnd,
    retentionDays,
    configError: errors.length ? errors.join(' ') : undefined,
    verificationCallId: env.CALLE_VERIFICATION_CALL_ID?.trim() || undefined,
  };
}
export const publicRecipient = (r: Recipient) => ({
  id: r.id,
  name: r.name,
  maskedPhone: `••• ••• ${r.phone.slice(-4)}`,
  timezone: r.timezone,
});
export function connection(config: Config, user: User) {
  const reasons: string[] = [];
  if (!config.enabled) reasons.push('Live calling is switched off on this server.');
  if (!config.apiKey) reasons.push('A server-side CALL-E API key is required.');
  if (!config.recipients.length) reasons.push('Add consenting test recipients on the server.');
  if (config.configError) reasons.push(config.configError);
  const configured = reasons.length === 0,
    authorized = !user.guest && config.users.includes(user.id);
  if (!authorized) reasons.push('Sign in with an account authorized for controlled live testing.');
  return {
    configured,
    authorized,
    reasons,
    recipients: authorized ? config.recipients.map(publicRecipient) : [],
    maxPerDay: config.maxPerDay,
    maxPerUserDay: config.maxPerUserDay,
    checks: [
      {
        id: 'credential',
        label: 'Server API key',
        ready: !!config.apiKey,
        detail: config.apiKey
          ? 'Saved on the server. Presence alone does not verify access.'
          : 'Add your CALL-E API key on the server.',
      },
      {
        id: 'account',
        label: 'Your account',
        ready: authorized,
        detail: user.guest
          ? 'Create an account, then ask the server operator to authorize it.'
          : authorized
            ? 'This account is authorized for controlled testing.'
            : 'Ask the server operator to authorize this account using its ID below.',
      },
      {
        id: 'recipients',
        label: 'Consenting recipients',
        ready: config.recipients.length > 0,
        detail:
          config.recipients.length > 0
            ? 'Test recipients are configured on the server.'
            : 'Add consenting test recipients on the server.',
      },
      {
        id: 'enabled',
        label: 'Live calling',
        ready: config.enabled,
        detail: config.enabled
          ? 'The server permits approved calls.'
          : 'Live calling is switched off on this server.',
      },
      {
        id: 'settings',
        label: 'Calling settings',
        ready: !config.configError,
        detail: config.configError
          ? 'The server operator needs to correct the calling settings.'
          : 'Recipient settings, calling hours and limits pass configuration checks.',
      },
    ],
  };
}
