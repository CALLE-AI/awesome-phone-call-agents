import 'dotenv/config';

export const E164_REGEX = /^\+[1-9]\d{7,14}$/;

export function validateE164Phone(phone: string): boolean {
  return E164_REGEX.test(phone);
}

export function maskPhoneNumber(phone: string): string {
  if (!phone || phone.length < 8) return '***[hidden]***';
  const prefix = phone.substring(0, 3);
  const suffix = phone.substring(phone.length - 4);
  return `${prefix}******${suffix}`;
}

export interface AppConfig {
  calleApiKey: string;
  onCallPhoneNumber: string;
  mode: 'preview' | 'live';
  port: number;
}

export function loadConfig(): AppConfig {
  const calleApiKey = process.env.CALLE_API_KEY || '';
  const onCallPhoneNumber = process.env.ONCALL_PHONE_NUMBER || '+12025550123';
  const mode = (process.env.VOICE_SRE_MODE || 'preview').toLowerCase() as 'preview' | 'live';
  const port = parseInt(process.env.PORT || '3000', 10);

  if (!validateE164Phone(onCallPhoneNumber)) {
    throw new Error(`Invalid phone number format '${onCallPhoneNumber}'. Must adhere to strict E.164 (e.g. +12025550123 or +84912345678).`);
  }

  return {
    calleApiKey,
    onCallPhoneNumber,
    mode,
    port
  };
}
