// Campaigns: a named batch of calls with a call budget.
//
// The budget is the spend governor. CALL-E calls cost money and credits, and a
// workflow bug can burn a month of them in a minute. A campaign cannot exceed
// its cap, and the cap is checked at dial time, not at queue time.
const store = require('./store');

function create({ name, budget, actor = 'operator' }) {
  const db = store.load();
  db.campaigns = db.campaigns || [];
  const c = {
    id: 'cmp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name || 'Untitled campaign',
    budget: Number(budget) || 0,
    createdAt: new Date().toISOString(),
    createdBy: actor,
    status: 'active'
  };
  db.campaigns.push(c);
  store.save(db);
  return c;
}

function get(id) {
  return (store.load().campaigns || []).find(c => c.id === id) || null;
}

function list() {
  return store.load().campaigns || [];
}

// Calls that have actually been sent to CALL-E, or are on their way.
const SPENT = ['dialing', 'complete', 'failed', 'needs_human'];

function spend(campaignId) {
  const jobs = store.listJobs().filter(j => j.campaignId === campaignId);
  return {
    spent: jobs.filter(j => SPENT.includes(j.status)).length,
    queued: jobs.filter(j => ['pending', 'approved', 'scheduled', 'needs_info'].includes(j.status)).length,
    stopped: jobs.filter(j => ['rejected', 'cancelled', 'expired'].includes(j.status)).length,
    total: jobs.length
  };
}

function checkBudget(campaignId) {
  if (!campaignId) return { ok: true };
  const c = get(campaignId);
  if (!c) return { ok: false, reason: 'Unknown campaign ' + campaignId };
  if (c.status === 'stopped') return { ok: false, reason: `Campaign "${c.name}" is stopped` };
  if (!c.budget) return { ok: true };
  const s = spend(campaignId);
  if (s.spent >= c.budget) {
    return { ok: false, reason: `Campaign "${c.name}" budget exhausted (${s.spent}/${c.budget} calls)` };
  }
  return { ok: true };
}

function warnLevel(campaignId) {
  const c = get(campaignId);
  if (!c || !c.budget) return null;
  const used = spend(campaignId).spent / c.budget;
  if (used >= 1) return 'exhausted';
  if (used >= 0.8) return 'warning';
  return null;
}

function stop(id, actor = 'operator') {
  const db = store.load();
  const c = (db.campaigns || []).find(x => x.id === id);
  if (!c) throw new Error('No such campaign: ' + id);
  c.status = 'stopped';
  store.save(db);
  let n = 0;
  for (const job of store.listJobs()) {
    if (job.campaignId === id && ['pending', 'approved', 'scheduled', 'needs_info'].includes(job.status)) {
      store.updateJob(job.id, { status: 'cancelled', confirmToken: null }, 'campaign_stopped', actor);
      n++;
    }
  }
  return { campaign: c, cancelled: n };
}

module.exports = { create, get, list, spend, checkBudget, warnLevel, stop, SPENT };
