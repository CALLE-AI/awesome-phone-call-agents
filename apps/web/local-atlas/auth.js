/* ---- accounts: Supabase as identity provider, nothing more ----
   Local Atlas needed accounts for two reasons, and only these two:

   1. Private Actions promise that a call you requested stays yours. Without an
      account that sentence is not true — a browser-local id is not an account,
      and saying otherwise on a privacy notice is the kind of claim you do not
      get to approximate.
   2. Every CALL-E call costs a credit, so the paths that can spend one need a
      name attached before they run.

   Supabase owns the email flow, the password/OTP handling and the session
   refresh. It does NOT own our data: preferences and private call records stay
   in store.js next to every other durable record this app keeps. Running
   Postgres beside Upstash for two small key-value shapes would buy a second
   thing to operate and a second thing to be down.

   Verification is a call to Supabase's own /auth/v1/user rather than local JWT
   checking. That trades a network round-trip (cached below) for not having to
   pick a signing algorithm, ship a JWT library, or track which of HS256 and
   the JWKS path a given project issues. At this traffic that is the right way
   round; if it ever isn't, this is the only function that has to change. */

const crypto = require('crypto');
const { docGet, docSet } = require('./store');

/* Render's dashboard accepts hyphens in variable names and calle.js already
   pays for that lesson — read both spellings here too. */
function env(...names){
  for(const n of names){ const v = process.env[n]; if(v) return v; }
  return '';
}
const SUPA_URL = env('SUPABASE_URL', 'SUPABASE-URL').replace(/\/$/, '');
/* The anon key is designed to be public — it ships to the browser and is
   useless without a user token. It is read here so the client can be handed it
   from /api/health rather than having it pasted into index.html, which would
   put a deploy-specific value in version control. */
const SUPA_ANON = env('SUPABASE_ANON_KEY', 'SUPABASE-ANON-KEY');

const configured = () => !!SUPA_URL && !!SUPA_ANON;

/* ---- review mode ----
   Requesting a call needs an account, which makes the whole feature
   unreachable on a machine with no Supabase project — someone reviewing this
   repository sees the map and the already-collected facts and never the thing
   worth reviewing. REVIEW_MODE=1 attaches a fixed local reviewer instead.

   What it is gated on is the inability to dial, not the intent not to. Two
   conditions produce that, and either will do: no CALL-E key at all, or
   CALLE_DRY_RUN=1, which calle.js enforces both at the decision (`live` reads
   it first) and at the transport (the credentialed client refuses to exist).
   Absent accounts is the third condition and is required — a deploy with a
   Supabase project has real users, and a fixed local reviewer has no business
   in it.

   The flag is off by default, and any real deployment fails at least one of
   the conditions above. */
const DRY_RUN = env('CALLE_DRY_RUN', 'CALL-E-DRY-RUN') === '1';
const REVIEW_MODE = env('REVIEW_MODE') === '1'
  && !configured()
  && (!env('CALLE_API_KEY', 'CALL-E-API-KEY') || DRY_RUN);
const REVIEW_USER = { id: 'review-mode-local', email: 'reviewer@localhost' };
if(env('REVIEW_MODE') === '1' && !REVIEW_MODE)
  console.warn('REVIEW_MODE ignored: it only applies with no Supabase project, and with either no CALL-E API key or CALLE_DRY_RUN=1.');
else if(REVIEW_MODE)
  console.warn('REVIEW_MODE on: call requests run as a local reviewer. Every call is simulated.');

const DAY = 86400e3;
const prefsKey = uid => 'atlas:prefs:' + uid;
const tokKey = t => 'auth:tok:' + crypto.createHash('sha256').update(t).digest('hex').slice(0, 32);

/* A verified token is cached briefly so a burst of requests from one open page
   is one round-trip, not six. The cost of the cache is the only thing worth
   stating plainly: for up to TOKEN_TTL after a sign-out, a stolen copy of that
   token still verifies. Sixty seconds is short enough that the exposure is
   smaller than the token's own hour-long lifetime, which is the real bound. */
const TOKEN_TTL = 60e3;

async function verifyToken(token){
  if(!configured() || !token) return null;
  const ck = tokKey(token);
  try{
    const hit = await docGet(ck);
    if(hit) return hit;
  }catch(e){}   // a store miss must never be an auth failure

  let r;
  try{
    r = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + token }
    });
  }catch(e){ return null; }
  if(!r.ok) return null;

  const u = await r.json().catch(() => null);
  if(!u || !u.id) return null;
  const user = { id: u.id, email: u.email || '' };
  try{ await docSet(ck, user, TOKEN_TTL); }catch(e){}
  return user;
}

const bearer = req => {
  const h = String(req.get('authorization') || '');
  return /^Bearer\s+(.+)$/i.test(h) ? h.replace(/^Bearer\s+/i, '').trim() : '';
};

/* Attaches req.user when a valid token is present and says nothing otherwise.
   Anonymous browsing is the normal case for this app — the map, the listings
   and every already-answered verified fact stay open to everyone — so the
   default path through here is "no user, carry on". */
async function attachUser(req, res, next){
  try{ req.user = await verifyToken(bearer(req)); }catch(e){ req.user = null; }
  next();
}

/* The gate for anything that can spend a CALL-E credit. `code` is what the
   client keys on to open its sign-in sheet, so it is part of the contract and
   not just prose. When Supabase is not configured at all this reports that
   distinctly: "sign in" is useless advice on a deploy with nowhere to sign in
   to, and a demo box without the env vars should say so. */
function requireUser(req, res, next){
  if(req.user) return next();
  if(REVIEW_MODE){ req.user = REVIEW_USER; return next(); }
  if(!configured())
    return res.status(503).json({ error: 'Accounts are not configured on this server.', code: 'auth_unconfigured' });
  return res.status(401).json({ error: 'Sign in to request a call.', code: 'auth_required' });
}

/* ---- per-account preferences ----
   Only tab visibility today. Kept as a whitelist rather than free-form keys so
   a preferences write cannot become a way to store arbitrary data under an
   account, and so an unknown tab id from an older client is dropped instead of
   persisted forever. */
const TAB_IDS = ['weather', 'alerts', 'surf', 'news', 'events', 'services', 'attractions',
  'food', 'shopping', 'favorites', 'kids', 'cams', 'radio', 'social', 'saved',
  'brief', 'laws', 'cost'];

const DEFAULT_PREFS = { hiddenTabs: [] };

async function getPrefs(uid){
  const p = (await docGet(prefsKey(uid))) || {};
  return { ...DEFAULT_PREFS, ...p, hiddenTabs: cleanTabs(p.hiddenTabs) };
}

const cleanTabs = list => Array.isArray(list)
  ? [...new Set(list.filter(t => TAB_IDS.includes(t)))]
  : [];

async function setPrefs(uid, patch){
  const cur = await getPrefs(uid);
  const next = { ...cur };
  if(patch && 'hiddenTabs' in patch) next.hiddenTabs = cleanTabs(patch.hiddenTabs);
  next.updatedAt = Date.now();
  await docSet(prefsKey(uid), next, 365 * DAY);
  return next;
}

module.exports = {
  configured, verifyToken, attachUser, requireUser, getPrefs, setPrefs, TAB_IDS,
  /* Public config only — the anon key belongs in the browser by design. There
     is no service-role key anywhere in this app, and nothing here should ever
     become the place one gets added. */
  /* reviewMode is reported so the client can stop asking a reviewer to sign in
     to an identity provider this deploy does not have. */
  info: () => ({ configured: configured(), url: SUPA_URL, anonKey: SUPA_ANON,
                 reviewMode: REVIEW_MODE })
};
