import type { Settings } from './model';

// Only this boolean is published by next.config.ts, never CALL-E credentials.
export const PUBLIC_DEMO = process.env.NEXT_PUBLIC_DEMO_ONLY === 'true';
export function publicDemoEnabled() {
  return PUBLIC_DEMO || process.env.VERCEL === '1' || process.env.CLINIC_PUBLIC_DEMO === 'true';
}
export function demoSettings(): Settings {
  return {liveReady: false, liveEnabled: false, hasApiKey: false, hasTestPhone: false, testPhoneHint: '', testPhone: ''};
}
