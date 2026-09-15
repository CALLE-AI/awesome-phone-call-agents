export function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && url.host === host; }
  catch { return false; }
}
