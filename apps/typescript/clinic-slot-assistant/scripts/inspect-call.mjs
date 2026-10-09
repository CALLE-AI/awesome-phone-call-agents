import { loadEnvFile } from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CalleClient } from '@call-e/calle';
loadEnvFile('.env.local');
const id = process.argv[2];
if (!/^call_[A-Za-z0-9_-]+$/.test(id || '')) throw new Error('Supply a valid existing call ID');
const client = new CalleClient({apiKey: process.env.CALLE_API_KEY, fetch: request => fetch(request, {signal: AbortSignal.timeout(20000)})});
const result = await client.calls.get(id); // Read-only: never creates or retries a call.
mkdirSync('.data/evidence', {recursive:true});
writeFileSync(`.data/evidence/${id}.json`, JSON.stringify(result,null,2), {mode:0o600});
const redact = value => typeof value === 'string' ? value.replace(/\+?\d[\d ()-]{8,}\d/g, '[phone hidden]') : value;
console.log(JSON.stringify({id:result.id,status:result.status,taskCompleted:result.taskCompleted,summary:redact(result.summary),result:result.structuredResult,failureCode:result.failureCode,failureMessage:redact(result.failureMessage),recipients:result.recipients.map(r=>({status:r.status,result:r.structuredResult,attempts:r.attempts.map(a=>({status:a.status,failureCode:a.failureCode,failureMessage:redact(a.failureMessage),transcriptTurns:a.transcriptTurns.length}))}))},null,2));
