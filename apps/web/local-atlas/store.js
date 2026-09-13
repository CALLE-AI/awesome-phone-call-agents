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

/* ---- atomic counter ----
   `docGet` then `docSet` is three steps with two awaits between them, and every
   await is a chance for another request to read the same number before either
   writes. For most records here that costs nothing — they are keyed per call id
   and nobody else is touching them. For a counter it costs the thing the
   counter is for: ten concurrent requests against a cap of five all read zero,
   all decide there is room, and the last write leaves the total at one.

   INCRBY is one round trip that both reads and writes, so there is no window.
   The caller adds first and puts it back if the total came out over the cap —
   the total can therefore be briefly too high, never briefly too low, which
   makes a concurrent request refuse rather than overspend. */
async function docIncr(key, by, ttlMs){
  if(!RURL){
    /* Nothing is awaited between the read and the write, so on one thread this
       is as atomic as the Redis path. */
    const hit = mem.get(key);
    const live = hit && hit.exp > Date.now();
    const next = (live ? Number(hit.v) || 0 : 0) + by;
    mem.set(key, { v: next, exp: ttlMs ? Date.now() + ttlMs : (live ? hit.exp : Date.now() + 86400e3) });
    return next;
  }
  const r = await fetch(`${RURL}/incrby/${encodeURIComponent(key)}/${Math.round(by)}`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK } });
  if(!r.ok) throw new Error('store INCRBY HTTP ' + r.status);
  const j = await r.json();
  /* INCRBY does not set an expiry, and a counter that never expires is a budget
     that never resets. Set on every call rather than only on creation: one
     extra round trip a handful of times a day, against the alternative of a
     race deciding whether the key ever gets a TTL at all. */
  if(ttlMs) await fetch(
    `${RURL}/expire/${encodeURIComponent(key)}/${Math.max(1, Math.round(ttlMs / 1000))}`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK } }).catch(()=>{});
  return Number(j.result) || 0;
}

/* ---- deletion ----
   Added for account deletion, and a real DEL rather than the `docSet(k, null)`
   trick used to release a lock: someone asking to be forgotten is owed the
   record being gone, not a null parked over it for a second. Reports how many
   keys were actually removed, because "we deleted your data" is a claim that
   should be able to cite a number. */
async function docDel(...keys){
  const ks = keys.flat().filter(Boolean);
  if(!ks.length) return 0;
  if(!RURL) return ks.filter(k => mem.delete(k)).length;
  const r = await fetch(`${RURL}/del/${ks.map(encodeURIComponent).join('/')}`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK } });
  if(!r.ok) throw new Error('store DEL HTTP ' + r.status);
  const j = await r.json();
  return Number(j.result) || 0;
}

/* ---- key enumeration ----
   Every other read here is by exact key, on purpose: a key-value store used as
   a key-value store stays fast and predictable. This exists for one caller —
   deleting an account has to find records whose keys embed a uid, and an index
   would only cover accounts created after it shipped, which is the wrong answer
   for anyone asking today.

   SCAN, not KEYS: KEYS blocks Redis for the length of the scan. The cursor loop
   is bounded so a pattern that matches everything cannot spin forever, and
   duplicates are possible mid-resize, so results are deduped. */
async function docScan(pattern, limit = 5000){
  if(!RURL){
    const rx = new RegExp('^' + String(pattern).split('*').map(s =>
      s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return [...mem.keys()].filter(k => rx.test(k)).slice(0, limit);
  }
  const found = new Set();
  let cursor = '0', rounds = 0;
  do{
    const r = await fetch(`${RURL}/scan/${cursor}?match=${encodeURIComponent(pattern)}&count=200`,
      { headers: { Authorization: 'Bearer ' + RTOK } });
    if(!r.ok) throw new Error('store SCAN HTTP ' + r.status);
    const j = await r.json();
    const [next, keys] = j.result || ['0', []];
    (keys || []).forEach(k => found.add(k));
    cursor = String(next);
  }while(cursor !== '0' && found.size < limit && ++rounds < 200);
  return [...found].slice(0, limit);
}

module.exports = { docGet, docSet, docIncr, docDel, docScan, configured: () => !!RURL };
