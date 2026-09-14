// Job store. Deliberately a plain JSON file so anyone can inspect it.
const fs = require('fs');
const path = require('path');

// Overridable so the test suite never writes into the live queue.
const FILE = process.env.SWITCHBOARD_DATA_FILE
  || path.join(__dirname, '..', 'data', 'jobs.json');

function load() {
  if (!fs.existsSync(FILE)) return { jobs: [], audit: [] };
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

function newId() {
  return 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// status: pending | approved | rejected | dialing | complete | failed | cancelled
function createJob(job) {
  const db = load();
  const record = {
    id: newId(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    recipient: job.recipient,
    userInput: job.userInput,
    goal: job.goal,
    resultSchema: job.resultSchema || null,
    mode: job.mode || 'require_approval',
    plan: job.plan || null,
    callRunId: null,
    result: null,
    validation: null,
    ...job.extra
  };
  db.jobs.push(record);
  audit(db, record.id, 'created', job.actor || 'workflow');
  save(db);
  return record;
}

function getJob(id) {
  return load().jobs.find(j => j.id === id) || null;
}

function listJobs(status) {
  const db = load();
  return status ? db.jobs.filter(j => j.status === status) : db.jobs;
}

function updateJob(id, patch, action, actor) {
  const db = load();
  const job = db.jobs.find(j => j.id === id);
  if (!job) throw new Error('No such job: ' + id);
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  if (action) audit(db, id, action, actor || 'system');
  save(db);
  return job;
}

function audit(db, jobId, action, actor) {
  db.audit.push({ at: new Date().toISOString(), jobId, action, actor });
}

function killAll(actor) {
  const db = load();
  let n = 0;
  // Matches what the console button actually promises: everything not yet
  // dispatched, including scheduled jobs and ones still waiting on CALL-E's
  // clarifying questions.
  const cancellable = ['pending', 'approved', 'scheduled', 'needs_info'];
  for (const job of db.jobs) {
    if (cancellable.includes(job.status)) {
      job.status = 'cancelled';
      job.confirmToken = null;
      job.updatedAt = new Date().toISOString();
      audit(db, job.id, 'kill_switch', actor || 'operator');
      n++;
    }
  }
  save(db);
  return n;
}

function auditLog() {
  return load().audit;
}

module.exports = { createJob, getJob, listJobs, updateJob, killAll, auditLog, load, save };
