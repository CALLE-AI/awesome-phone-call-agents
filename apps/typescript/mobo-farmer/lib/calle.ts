import { CalleClient } from '@call-e/calle';

export const calleClient = new CalleClient({ apiKey: process.env.CALLE_API_KEY || 'mock_key' });
export const hasCalleKey = !!process.env.CALLE_API_KEY && (process.env.CALLE_API_KEY.startsWith("calle_") || process.env.CALLE_API_KEY.startsWith("iams_live_"));
