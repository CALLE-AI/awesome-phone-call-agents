/* ---- durable record store ----
   Deliberately separate from server.js's cached() helper: that is a
   read-through cache where a miss is free and a lost write is invisible.
   These are records a user is waiting on, so writes are awaited and reported.
   Falls back to memory so the flow is demoable without Upstash.

   Lifted out of calle.js once a second caller appeared (auth.js keeps account
   preferences here). One store, one fallback, one place to change if this ever
   grows past Upstash — two modules each half-implementing the same KV would be
   two things to get wrong. */
const RURL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const mem = new Map();

async function docGet(key){
  if(!RURL){
    const hit = mem.get(key);
    return hit && hit.exp > Date.now() ? hit.v : null;
  }
  const r = await fetch(`${RURL}/get/${encodeURIComponent(key)}`,
    { headers: { Authorization: 'Bearer ' + RTOK } });
  if(!r.ok) throw new Error('store GET HTTP ' + r.status);
  const j = await r.json();
  if(typeof j.result !== 'string') return null;
  try{ return JSON.parse(j.result); }catch(e){ return null; }
}
async function docSet(key, val, ttlMs){
  if(!RURL){ mem.set(key, { v: val, exp: Date.now() + ttlMs }); return; }
  const r = await fetch(`${RURL}/set/${encodeURIComponent(key)}?px=${Math.max(1000, Math.round(ttlMs))}`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK }, body: JSON.stringify(val) });
  if(!r.ok) throw new Error('store SET HTTP ' + r.status);
}

module.exports = { docGet, docSet, configured: () => !!RURL };
