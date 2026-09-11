import assert from "node:assert/strict";

const base = (process.env.PUBLIC_DEMO_URL || "https://e-mploye-for-calle.vercel.app").replace(/\/+$/, "");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const request = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
};

const post = async (path, body = {}) => {
  const result = await request(path, { method: "POST", body: JSON.stringify(body) });
  assert.equal(result.response.ok, true, `${path} failed: ${JSON.stringify(result.body)}`);
  return result.body;
};

const jobFor = (state, id) => state.jobs.find((job) => job.id === id);
const approvalFor = (state, jobId) => state.approvals.find((approval) => approval.jobId === jobId);
const create = (employeeId, shiftId, fakeOutcome, workflowType = "shift_coordination") => post("/api/jobs", { employeeId, shiftId, fakeOutcome, workflowType });

const run = async () => {
  const page = await fetch(base);
  assert.equal(page.ok, true);
  assert.match(await page.text(), /E-mploye/);

  const health = (await request("/api/health")).body;
  assert.equal(health.ok, true);
  assert.equal(health.runtime.provider, "fake");
  assert.equal(health.runtime.workflows.length, 3);
  await post("/api/reset");

  const preview = await post("/api/jobs/preview", { employeeId: "emp-ana", shiftId: "shift-ana-1", fakeOutcome: "reschedule_requested" });
  assert.equal(preview.safety.ok, true);
  assert.equal(preview.workflowType, "shift_coordination");

  const matrix = [
    ["appointment_management", "emp-ana", "shift-ana-1"],
    ["lead_follow_up", "emp-diego", "shift-diego-1"],
    ["shift_coordination", "emp-lucia", "shift-lucia-1"],
  ];
  const outcomes = ["confirmed", "reschedule_requested", "declined", "unknown"];
  let matrixCases = 0;
  for (const [workflowType, employeeId, shiftId] of matrix) {
    for (const fakeOutcome of outcomes) {
      await post("/api/reset");
      const created = await create(employeeId, shiftId, fakeOutcome, workflowType);
      const jobId = created.jobs[0].id;
      await post(`/api/jobs/${jobId}/approve`);
      await wait(900);
      const reviewed = await post(`/api/jobs/${jobId}/refresh`);
      const job = jobFor(reviewed, jobId);
      assert.equal(job.workflowType, workflowType);
      assert.equal(job.result.outcome, fakeOutcome);
      assert.ok(job.result.contact_message);
      if (["confirmed", "reschedule_requested"].includes(fakeOutcome)) {
        const applied = await post(`/api/jobs/${jobId}/apply`);
        assert.equal(jobFor(applied, jobId).status, "applied");
        assert.equal(approvalFor(applied, jobId).status, "approved");
        assert.equal(applied.shifts.find((shift) => shift.id === shiftId).status, fakeOutcome === "confirmed" ? "confirmed" : "rescheduled");
      } else {
        const blockedApply = await request(`/api/jobs/${jobId}/apply`, { method: "POST", body: "{}" });
        assert.equal(blockedApply.response.status, 400);
        const rejected = await post(`/api/jobs/${jobId}/reject`);
        assert.equal(jobFor(rejected, jobId).status, "rejected");
        assert.equal(approvalFor(rejected, jobId).status, "rejected");
        assert.equal(rejected.shifts.find((shift) => shift.id === shiftId).status, "scheduled");
      }
      matrixCases += 1;
    }
  }

  await post("/api/reset");
  const failed = await create("emp-diego", "shift-diego-1", "failed");
  const failedId = failed.jobs[0].id;
  await post(`/api/jobs/${failedId}/approve`);
  await wait(900);
  const failedReview = await post(`/api/jobs/${failedId}/refresh`);
  const failedJob = jobFor(failedReview, failedId);
  assert.equal(failedJob.status, "failed");
  assert.equal(failedJob.failureCode, "fake_provider_failure");
  const retry = await post(`/api/jobs/${failedId}/retry`);
  assert.equal(jobFor(retry, failedId).status, "awaiting_approval");
  assert.equal(jobFor(retry, failedId).providerCallId, null);

  await post("/api/reset");
  const cancel = await create("emp-lucia", "shift-lucia-1", "confirmed");
  const cancelId = cancel.jobs[0].id;
  const queued = await post(`/api/jobs/${cancelId}/approve`);
  assert.ok(["queued", "in_progress"].includes(jobFor(queued, cancelId).status));
  const canceled = await post(`/api/jobs/${cancelId}/cancel`);
  assert.equal(jobFor(canceled, cancelId).status, "canceled");
  assert.equal(canceled.shifts.find((shift) => shift.id === "shift-lucia-1").status, "scheduled");

  await post("/api/reset");
  console.log(JSON.stringify({ ok: true, base, scenarios: matrixCases + 2, matrixCases, finalJobs: 0 }));
};

run().catch(async (error) => {
  try { await post("/api/reset"); } catch { /* preserve the original failure */ }
  console.error(error);
  process.exitCode = 1;
});
