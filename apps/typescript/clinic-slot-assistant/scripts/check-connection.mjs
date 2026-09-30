import { loadEnvFile } from 'node:process';
loadEnvFile('.env.local');
if (!process.env.CALLE_API_KEY) throw new Error('No API key configured');
const url = `https://api.heycall-e.com/v1/calls/call_connection_probe_${crypto.randomUUID().replaceAll('-', '')}`;
// Read-only probe: never creates a call, never prints credentials or response bodies.
async function probe(authenticated) {
  try {
    const response = await fetch(url, {headers: authenticated ? {Authorization: `Bearer ${process.env.CALLE_API_KEY}`} : {}, signal: AbortSignal.timeout(20000)});
    let code = null;
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      const body = await response.json();
      const candidate = body?.error?.code ?? body?.code;
      if (typeof candidate === 'string' && /^[a-z_]{1,60}$/.test(candidate)) code = candidate;
    }
    return {status: response.status, code};
  } catch (error) { return {networkError: true, code: error?.cause?.code ?? error?.name ?? 'unknown'}; }
}
const unauthenticated = await probe(false);
const authenticated = await probe(true);
const recognized = [401,403].includes(unauthenticated.status) && authenticated.status === 404;
console.log(JSON.stringify({unauthenticated, authenticated, credentialAcceptedByProbe: recognized, realCallPlaced: false}));
if (unauthenticated.networkError || authenticated.networkError) process.exitCode = 2;
