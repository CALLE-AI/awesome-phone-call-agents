// Switchboard console. No framework, no build step, no dependencies.
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('../core/store');
const runner = require('../core/runner');
const campaign = require('../core/campaign');

const PORT = Number(process.env.SWITCHBOARD_PORT || 4300);

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

async function runInBackground(jobId) {
  try {
    const dialed = await runner.dial(jobId, 'operator');
    if (dialed.status === 'dialing' && dialed.callRunId) await runner.follow(jobId);
  } catch (err) {
    store.updateJob(jobId, { status: 'failed', error: err.message }, 'background_failed', 'system');
  }
}

// Scheduled jobs are planned only when they fall due. Until then nothing has
// been sent to CALL-E, which is what makes cancelling one genuinely possible.
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const promoted = await runner.promoteDue();
    if (promoted.length) console.log('  promoted', promoted.length, 'scheduled job(s)');
  } catch (err) {
    console.error('  scheduler tick failed:', err.message);
  } finally {
    ticking = false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'), 'text/html');
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const campaigns = campaign.list().map(c => ({
      ...c, spend: campaign.spend(c.id), warn: campaign.warnLevel(c.id)
    }));
    return send(res, 200, { jobs: store.listJobs().map(runner.redact).reverse(), campaigns,
      audit: store.auditLog().slice(-60).reverse() });
  }

  if (url.pathname === '/api/kill' && req.method === 'POST') {
    return send(res, 200, { cancelled: store.killAll('operator') });
  }

  if (url.pathname === '/api/bulk' && req.method === 'POST') {
    const body = await readBody(req);
    const ids = body.ids || [];
    let n = 0;
    for (const id of ids) {
      const job = store.getJob(id);
      if (!job) continue;
      if (body.action === 'approve' && job.status === 'pending') {
        store.updateJob(id, { status: 'approved' }, 'approved', 'operator');
        runInBackground(id);
        n++;
      } else if (body.action === 'reject' && ['pending', 'scheduled', 'needs_info'].includes(job.status)) {
        store.updateJob(id, { status: 'rejected', confirmToken: null }, 'rejected', 'operator');
        n++;
      }
    }
    return send(res, 200, { affected: n });
  }

  if (parts[0] === 'api' && parts[1] === 'campaigns') {
    if (req.method === 'POST' && !parts[2]) {
      const body = await readBody(req);
      return send(res, 200, campaign.create({ name: body.name, budget: body.budget }));
    }
    if (req.method === 'POST' && parts[3] === 'stop') {
      try { return send(res, 200, campaign.stop(parts[2], 'operator')); }
      catch (err) { return send(res, 404, { error: err.message }); }
    }
  }

  if (parts[0] === 'api' && parts[1] === 'jobs' && parts[3] && req.method === 'POST') {
    const id = parts[2], action = parts[3];
    const job = store.getJob(id);
    if (!job) return send(res, 404, { error: 'No such job' });
    try {
      if (action === 'approve') {
        if (job.status !== 'pending') return send(res, 409, { error: 'Job is ' + job.status + ', not pending' });
        store.updateJob(id, { status: 'approved' }, 'approved', 'operator');
        runInBackground(id);
        return send(res, 200, { ok: true });
      }
      if (action === 'reject') {
        store.updateJob(id, { status: 'rejected', confirmToken: null }, 'rejected', 'operator');
        return send(res, 200, { ok: true });
      }
      if (action === 'cancel') {
        store.updateJob(id, { status: 'cancelled', confirmToken: null }, 'cancelled', 'operator');
        return send(res, 200, { ok: true });
      }
      if (action === 'answer') {
        const body = await readBody(req);
        const updated = await runner.answer(id, body.answer || '', { timezone: body.timezone });
        return send(res, 200, { ok: true, status: updated.status });
      }
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
    return send(res, 400, { error: 'Unknown action' });
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  Switchboard console  http://localhost:' + PORT + '  (loopback only)\n');
  setInterval(tick, 30000);
  tick();
});
