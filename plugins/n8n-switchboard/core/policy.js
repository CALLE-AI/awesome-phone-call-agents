// Pre-dial policy checks. Every one of these runs before a number is ever dialed.
const store = require('./store');

// CALL-E publishes supported regions as documentation, not data. `calle regions
// list` returns a URL rather than a list, so this is a dated snapshot of
// https://github.com/CALLE-AI/call-e-integrations#supported-regions-and-languages
// and it will drift. Override it with SWITCHBOARD_REGIONS rather than editing code.
const REGIONS_SNAPSHOT_DATE = '2026-09-12';
const DEFAULT_REGIONS = ['US','SG','MY','IN','AE','AU','CA','GB','VN','DE','JP','FR','MX','BR','ID','PH','KE'];
const SUPPORTED_REGIONS = (process.env.SWITCHBOARD_REGIONS || '')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
if (!SUPPORTED_REGIONS.length) SUPPORTED_REGIONS.push(...DEFAULT_REGIONS);

const BLOCKLIST = new Set(
  (process.env.SWITCHBOARD_BLOCKLIST || '').split(',').map(s => s.trim()).filter(Boolean)
);

// Loose E.164 check. Not a full validator, just catches obviously malformed
// input before it burns a plan_call request.
const E164 = /^\+[1-9]\d{7,14}$/;
function checkDestinationFormat(phone) {
  if (!phone || !E164.test(phone)) {
    return { ok: false, reason: `"${phone || ''}" is not a valid E.164 number` };
  }
  return { ok: true };
}

function checkRegion(region) {
  if (!region) return { ok: false, reason: 'No recipient region supplied' };
  if (!SUPPORTED_REGIONS.includes(region.toUpperCase())) {
    return { ok: false, advisory: true,
      reason: `Region ${region} is not on CALL-E's published list (snapshot ${REGIONS_SNAPSHOT_DATE}). ` +
              `The list is documentation, not an API. Override with SWITCHBOARD_REGIONS if you know better.` };
  }
  return { ok: true };
}

function checkBlocklist(phone) {
  if (BLOCKLIST.has(phone)) return { ok: false, reason: 'Recipient is on the blocklist' };
  return { ok: true };
}

function checkQuietHours(now = new Date()) {
  const start = process.env.SWITCHBOARD_QUIET_START || '21:00';
  const end = process.env.SWITCHBOARD_QUIET_END || '08:00';
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const s = toMins(start), e = toMins(end);
  const inQuiet = s > e ? (mins >= s || mins < e) : (mins >= s && mins < e);
  return inQuiet ? { ok: false, reason: `Inside quiet hours ${start}-${end}` } : { ok: true };
}

function checkRateLimit(phone) {
  const max = Number(process.env.SWITCHBOARD_MAX_CALLS_PER_RECIPIENT_PER_DAY || 2);
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const count = store.listJobs().filter(j =>
    j.recipient && j.recipient.phone === phone &&
    ['pending', 'approved', 'dialing', 'complete', 'failed', 'needs_info'].includes(j.status) &&
    new Date(j.createdAt).getTime() > since
  ).length;
  return count >= max
    ? { ok: false, reason: `Rate limit reached: ${count} calls in the last 24h` }
    : { ok: true };
}

function evaluate(recipient, now = new Date()) {
  const checks = [
    ['destination_format', checkDestinationFormat(recipient.phone)],
    ['region', checkRegion(recipient.region)],
    ['blocklist', checkBlocklist(recipient.phone)],
    ['quiet_hours', checkQuietHours(now)],
    ['rate_limit', checkRateLimit(recipient.phone)]
  ];
  const failed = checks.filter(([, r]) => !r.ok);
  return {
    ok: failed.length === 0,
    checks: checks.map(([name, r]) => ({ name, ...r })),
    reasons: failed.map(([, r]) => r.reason)
  };
}

module.exports = { evaluate, SUPPORTED_REGIONS, REGIONS_SNAPSHOT_DATE, DEFAULT_REGIONS };
