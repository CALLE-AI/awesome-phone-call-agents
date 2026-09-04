import crypto from "node:crypto";
import { getConfig, isLiveReady, publicRuntimeConfig } from "./config.mjs";
import { CalleApiProvider } from "./calle-api-provider.mjs";
import { FakeCallProvider } from "./fake-call-provider.mjs";
import { JsonStateStore } from "./persistence.mjs";
import { evaluateCallSafety, isE164, maskPhone } from "./safety-policy.mjs";
import { DEFAULT_WORKFLOW_TYPE, getWorkflowTemplate, publicWorkflowTemplates } from "./workflow-catalog.mjs";

const OUTCOMES = ["confirmed", "reschedule_requested", "declined", "unknown"];
const TERMINAL_PROVIDER_STATUSES = new Set(["completed", "failed", "canceled"]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;

export const resultSchema = {
  type: "object",
  required: ["outcome", "requested_date", "requested_time", "contact_message", "confidence", "needs_manager_review"],
  additionalProperties: false,
  properties: {
    outcome: { type: "string", enum: OUTCOMES, description: "Disposition from the contact's answer." },
    requested_date: { type: "string", description: "Alternate ISO date, or an empty string when none was requested." },
    requested_time: { type: "string", description: "Alternate local time, or an empty string when none was requested." },
    contact_message: { type: "string", description: "Short evidence-based summary of what the contact said." },
    confidence: { type: "number", description: "Confidence from 0 to 1." },
    needs_manager_review: { type: "boolean", description: "True unless the answer is safe to treat as a confirmation." },
  },
};

const seedState = (liveEnabled = false) => {
  const employees = liveEnabled ? [] : [
    { id: "emp-ana", name: "Ana Morales", role: "Customer · Luna Studio", business: "Luna Studio", phone: "+15550101001", locale: "en-US", region: "MX" },
    { id: "emp-diego", name: "Diego Rivera", role: "Prospect · Norte Services", business: "Norte Services", phone: "+15550101002", locale: "en-US", region: "MX" },
    { id: "emp-lucia", name: "Lucía Torres", role: "Team member · Calle Ops", business: "Calle Ops", phone: "+15550101003", locale: "en-US", region: "MX" },
  ];
  const shifts = liveEnabled ? [] : [
    { id: "shift-ana-1", employeeId: "emp-ana", date: "2026-09-07", startTime: "09:00", endTime: "10:00", role: "Service appointment", status: "scheduled" },
    { id: "shift-diego-1", employeeId: "emp-diego", date: "2026-09-08", startTime: "10:00", endTime: "11:00", role: "Discovery call", status: "scheduled" },
    { id: "shift-lucia-1", employeeId: "emp-lucia", date: "2026-09-09", startTime: "08:00", endTime: "16:00", role: "Operations shift", status: "scheduled" },
  ];
  return {
    version: 3,
    executionMode: liveEnabled ? "live" : "fake",
    employees,
    shifts,
    jobs: [],
    approvals: [],
    events: [{ id: id("evt"), type: "system", message: liveEnabled ? "Live mode is ready. Load one authorized workspace before creating a call." : "E-mploye is ready in fake mode. No call has been placed.", createdAt: nowIso() }],
  };
};

const statusForProvider = (status) => ({ queued: "queued", in_progress: "in_progress", completed: "needs_review", failed: "failed", canceled: "canceled" }[status] || "failed");

const safeResult = (value) => {
  const result = value && typeof value === "object" ? value : {};
  const contactMessage = typeof result.contact_message === "string"
    ? result.contact_message
    : typeof result.employee_message === "string"
      ? result.employee_message
      : "No reliable contact message was returned.";
  return {
    outcome: OUTCOMES.includes(result.outcome) ? result.outcome : "unknown",
    requested_date: typeof result.requested_date === "string" ? result.requested_date : "",
    requested_time: typeof result.requested_time === "string" ? result.requested_time : "",
    contact_message: contactMessage,
    confidence: typeof result.confidence === "number" ? Math.max(0, Math.min(1, result.confidence)) : 0,
    needs_manager_review: result.needs_manager_review !== false,
  };
};

const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const isLocalTime = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
const minutesFromTime = (value) => {
  if (!isLocalTime(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};
const timeFromMinutes = (value) => {
  const normalized = value % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
};
const transcriptFromProvider = (providerResponse) => {
  if (Array.isArray(providerResponse.transcript_turns)) return providerResponse.transcript_turns;
  return (Array.isArray(providerResponse.recipients) ? providerResponse.recipients : [])
    .flatMap((recipient) => Array.isArray(recipient?.attempts) ? recipient.attempts : [])
    .flatMap((attempt) => Array.isArray(attempt?.transcript_turns) ? attempt.transcript_turns : []);
};

export class CallWorkflow {
  constructor({ store, provider, config = getConfig(), clock = nowIso } = {}) {
    this.config = config;
    this.store = store || new JsonStateStore(config.stateFile, () => seedState(isLiveReady(config)));
    this.provider = provider || (isLiveReady(config)
      ? new CalleApiProvider({
        apiKey: config.calleApiKey,
        baseUrl: config.calleBaseUrl,
        liveEnabled: true,
      })
      : new FakeCallProvider());
    this.clock = clock;
  }

  state() {
    let state = this.store.load();
    const expectedMode = isLiveReady(this.config) ? "live" : "fake";
    if ((expectedMode === "live" && state.executionMode !== "live") || (expectedMode === "fake" && state.executionMode === "live")) {
      state = seedState(expectedMode === "live");
      this.store.state = state;
      this.store.save();
    }
    state.jobs = state.jobs.map((job) => ({ workflowType: DEFAULT_WORKFLOW_TYPE, ...job }));
    return state;
  }

  response() {
    const state = this.state();
    const publicState = clone(state);
    if (this.provider.name === "live") {
      publicState.employees = publicState.employees.map((employee) => ({ ...employee, phone: maskPhone(employee.phone) }));
    }
    return {
      ...publicState,
      runtime: { ...publicRuntimeConfig(this.config), workflows: publicWorkflowTemplates(), workspaceConfigured: this.provider.name === "live" && state.employees.length > 0 && state.shifts.length > 0 },
    };
  }

  addEvent(state, type, message, jobId) {
    state.events.unshift({ id: id("evt"), type, message, createdAt: this.clock(), ...(jobId ? { jobId } : {}) });
    state.events = state.events.slice(0, 80);
  }

  findContext(state, employeeId, shiftId) {
    const employee = state.employees.find((item) => item.id === employeeId);
    const shift = state.shifts.find((item) => item.id === shiftId);
    if (!employee) throw new Error("Employee not found");
    if (!shift || shift.employeeId !== employee.id) throw new Error("Shift does not belong to the selected employee");
    return { employee, shift };
  }

  callRecipient(employee) {
    if (this.provider.name !== "live") return employee;
    if (!isLiveReady(this.config)) throw new Error("Live CALL-E is not ready; configure the server-side key, test phone, region, and locale first");
    if (!employee || employee.phone !== this.config.calleTestPhone) throw new Error("Live mode only allows the server-configured authorized E.164 test phone");
    return {
      ...employee,
      phone: this.config.calleTestPhone,
      region: this.config.calleTestRegion,
      locale: this.config.calleTestLocale,
    };
  }

  preview({ employeeId, shiftId, proposedDate, proposedTime, fakeOutcome = "confirmed", workflowType = DEFAULT_WORKFLOW_TYPE }) {
    const state = this.state();
    const { employee, shift } = this.findContext(state, employeeId, shiftId);
    const workflow = getWorkflowTemplate(workflowType);
    const callEmployee = this.callRecipient(employee);
    const date = proposedDate || shift.date;
    const time = proposedTime || shift.startTime;
    if (!isIsoDate(date)) throw new Error("Proposed date must use YYYY-MM-DD");
    if (!isLocalTime(time)) throw new Error("Proposed start must use HH:MM");
    const business = employee.business || workflow.business;
    const task = [
      `Act as E-mploye, a virtual employee for ${business}.`,
      `Call ${employee.name} about the ${workflow.recordLabel.toLowerCase()} called ${shift.role}.`,
      `The proposed ${workflow.recordLabel.toLowerCase()} is ${date} from ${time} to ${shift.endTime}.`,
      `Disclose that you are an AI calling for E-mploye and ask whether the ${workflow.recordLabel.toLowerCase()} works for them.`,
      "If it does not work, ask whether they want to suggest one alternate date and time. Do not promise or apply a change.",
      "Return only the requested structured result and a concise evidence summary.",
    ].join(" ");
    const safety = evaluateCallSafety({ employee: callEmployee, task, managerApproved: true, idempotencyKey: "preview", recurring: false });
    return {
      workflowType: workflow.id,
      workflow,
      employee: { id: callEmployee.id, name: callEmployee.name, role: callEmployee.role, phone: maskPhone(callEmployee.phone) },
      shift: clone(shift),
      proposedDate: date,
      proposedTime: time,
      task,
      resultSchema,
      provider: this.provider.name,
      fakeOutcome: this.provider.name === "fake" ? fakeOutcome : undefined,
      safety,
    };
  }

  configureLiveWorkspace({ workflowType = DEFAULT_WORKFLOW_TYPE, name, phone, business, recordLabel, date, startTime, endTime, region, locale }) {
    if (this.provider.name !== "live" || !isLiveReady(this.config)) throw new Error("Live CALL-E is not ready; configure the server-side key, test phone, region, and locale first");
    const state = this.state();
    if (state.jobs.length) throw new Error("Reset the live workspace before loading new contact data");

    const workflow = getWorkflowTemplate(workflowType);
    const contactName = String(name || "").trim();
    const contactPhone = String(phone || "").trim();
    const contactBusiness = String(business || "").trim();
    const contextLabel = String(recordLabel || "").trim();
    const contextDate = String(date || "").trim();
    const contextStart = String(startTime || "").trim();
    const contextEnd = String(endTime || "").trim();
    const destinationRegion = String(region || "").trim().toUpperCase();
    const destinationLocale = String(locale || "").trim();
    if (!contactName || contactName.length > 120) throw new Error("Contact name is required and must be under 120 characters");
    if (!isE164(contactPhone)) throw new Error("Live contact phone must use E.164 format");
    if (contactPhone !== this.config.calleTestPhone) throw new Error("Live contact phone must match the server-configured authorized test phone");
    if (!contactBusiness || contactBusiness.length > 120) throw new Error("Business name is required and must be under 120 characters");
    if (!contextLabel || contextLabel.length > 120) throw new Error("Scheduled context label is required and must be under 120 characters");
    if (!isIsoDate(contextDate)) throw new Error("Scheduled date must use YYYY-MM-DD");
    if (!isLocalTime(contextStart) || !isLocalTime(contextEnd) || minutesFromTime(contextEnd) <= minutesFromTime(contextStart)) throw new Error("Scheduled times must use HH:MM and end after start");
    if (destinationRegion !== this.config.calleTestRegion || destinationLocale !== this.config.calleTestLocale) throw new Error("Region and locale must match the server-configured CALL-E test destination");

    state.executionMode = "live";
    state.employees = [{
      id: "live-contact",
      name: contactName,
      role: `${workflow.recipientLabel} · ${contactBusiness}`,
      business: contactBusiness,
      phone: contactPhone,
      locale: destinationLocale,
      region: destinationRegion,
    }];
    state.shifts = [{
      id: "live-record",
      employeeId: "live-contact",
      date: contextDate,
      startTime: contextStart,
      endTime: contextEnd,
      role: contextLabel,
      status: "scheduled",
    }];
    this.addEvent(state, "live_workspace_loaded", `Live workspace loaded for ${workflow.label}; the authorized destination remains server-controlled.`, undefined);
    this.store.save();
    return this.response();
  }

  createJob(input) {
    const state = this.state();
    const preview = this.preview(input);
    const existing = state.jobs.find((job) => job.shiftId === input.shiftId && (job.workflowType || DEFAULT_WORKFLOW_TYPE) === preview.workflowType && !["applied", "rejected", "canceled"].includes(job.status));
    if (existing) throw new Error("An active call job already exists for this task");
    const jobId = id("job");
    const approvalId = id("approval");
    const job = {
      id: jobId,
      employeeId: input.employeeId,
      shiftId: input.shiftId,
      workflowType: preview.workflowType,
      proposedDate: preview.proposedDate,
      proposedTime: preview.proposedTime,
      fakeOutcome: input.fakeOutcome || "confirmed",
      task: preview.task,
      status: "awaiting_approval",
      provider: this.provider.name,
      providerStatus: null,
      providerCallId: null,
      outcome: null,
      result: null,
      evidence: [],
      transcript: [],
      failureCode: null,
      failureMessage: null,
      createdAt: this.clock(),
      updatedAt: this.clock(),
      idempotencyKey: `employe_${jobId}`,
      approvalId,
    };
    state.jobs.unshift(job);
    state.approvals.unshift({ id: approvalId, jobId, status: "pending", createdAt: this.clock(), decidedAt: null });
    this.addEvent(state, "approval_required", `${preview.workflow.label} prepared for ${preview.employee.name}; manager approval is required.`, jobId);
    this.store.save();
    return this.response();
  }

  async approve(jobId) {
    const state = this.state();
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error("Call job not found");
    if (job.status !== "awaiting_approval") throw new Error("Only a preview awaiting approval can be authorized");
    const employee = state.employees.find((item) => item.id === job.employeeId);
    const shift = state.shifts.find((item) => item.id === job.shiftId);
    const workflow = getWorkflowTemplate(job.workflowType);
    const callEmployee = this.callRecipient(employee);
    const approval = state.approvals.find((item) => item.id === job.approvalId);
    const safety = evaluateCallSafety({ employee: callEmployee, task: job.task, managerApproved: true, idempotencyKey: job.idempotencyKey });
    if (!safety.ok) throw new Error(safety.reason);
    if (approval) { approval.status = "approved"; approval.decidedAt = this.clock(); }
    job.status = "queued";
    job.updatedAt = this.clock();
    this.addEvent(state, "call_authorized", `Manager authorized the ${workflow.label.toLowerCase()} call to ${maskPhone(callEmployee.phone)}.`, job.id);
    this.store.save();
    try {
      const providerResponse = await this.provider.createCall({
        idempotencyKey: job.idempotencyKey,
        body: {
          task: job.task,
          recipients: [{ phones: [callEmployee.phone], region: callEmployee.region, locale: callEmployee.locale }],
          result_schema: resultSchema,
          metadata: {
            workflow_run_id: job.id,
            shift_id: shift.id,
            employee_id: employee.id,
            requested_date: job.proposedDate,
            requested_time: job.proposedTime,
            workflow_type: workflow.id,
            workflow_label: workflow.label,
            record_label: workflow.recordLabel,
            contact_name: employee.name,
            business_name: employee.business || workflow.business,
            ...(this.provider.name === "fake" ? { fake_outcome: job.fakeOutcome } : {}),
          },
        },
      });
      job.providerCallId = providerResponse.id;
      job.providerStatus = providerResponse.status;
      job.status = statusForProvider(providerResponse.status);
      job.failureCode = providerResponse.failure_code || null;
      job.failureMessage = providerResponse.failure_message || null;
      job.updatedAt = this.clock();
      this.addEvent(state, "call_created", `${this.provider.name === "fake" ? "Simulated" : "Live CALL-E"} call created with status ${providerResponse.status}.`, job.id);
    } catch (error) {
      job.status = "failed";
      job.failureCode = "provider_create_failed";
      job.failureMessage = error instanceof Error ? error.message : "Provider create failed";
      job.updatedAt = this.clock();
      this.addEvent(state, "call_failed", `Call creation failed: ${job.failureMessage}`, job.id);
    }
    this.store.save();
    return this.response();
  }

  async refresh(jobId) {
    const state = this.state();
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error("Call job not found");
    if (!job.providerCallId) return this.response();
    const providerResponse = await this.provider.getCall(job.providerCallId);
    job.providerStatus = providerResponse.status;
    job.updatedAt = this.clock();
    if (providerResponse.status === "completed") {
      job.status = "needs_review";
      job.result = safeResult(providerResponse.structured_result);
      job.outcome = job.result.outcome;
      job.evidence = Array.isArray(providerResponse.evidence) ? providerResponse.evidence : [];
      job.transcript = transcriptFromProvider(providerResponse);
      this.addEvent(state, "call_completed", `${getWorkflowTemplate(job.workflowType).label} completed with outcome ${job.outcome}; manager review is required before applying a change.`, job.id);
    } else if (TERMINAL_PROVIDER_STATUSES.has(providerResponse.status)) {
      job.status = statusForProvider(providerResponse.status);
      job.failureCode = providerResponse.failure_code || null;
      job.failureMessage = providerResponse.failure_message || null;
      this.addEvent(state, providerResponse.status === "canceled" ? "call_canceled" : "call_failed", `Provider status is ${providerResponse.status}.`, job.id);
    } else {
      job.status = statusForProvider(providerResponse.status);
    }
    this.store.save();
    return this.response();
  }

  apply(jobId) {
    const state = this.state();
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error("Call job not found");
    if (job.status !== "needs_review" || !job.result) throw new Error("Only a completed result can be approved");
    if (!["confirmed", "reschedule_requested"].includes(job.outcome)) throw new Error("This outcome cannot be applied; reject it or keep it for review");
    const shift = state.shifts.find((item) => item.id === job.shiftId);
    if (!shift) throw new Error("Scheduled item not found");
    if (job.outcome === "reschedule_requested") {
      if (!job.result.requested_date || !job.result.requested_time) throw new Error("The requested alternate time is incomplete");
      if (!isIsoDate(job.result.requested_date) || !isLocalTime(job.result.requested_time)) throw new Error("The requested alternate time has an invalid format");
      const originalStart = minutesFromTime(shift.startTime);
      const originalEnd = minutesFromTime(shift.endTime);
      const requestedStart = minutesFromTime(job.result.requested_time);
      const duration = originalStart !== null && originalEnd !== null && originalEnd > originalStart
        ? originalEnd - originalStart
        : null;
      shift.date = job.result.requested_date;
      shift.startTime = job.result.requested_time;
      if (duration !== null && requestedStart !== null && requestedStart + duration <= 24 * 60) {
        shift.endTime = timeFromMinutes(requestedStart + duration);
      }
      shift.status = "rescheduled";
    } else {
      shift.status = "confirmed";
    }
    job.status = "applied";
    job.updatedAt = this.clock();
    const workflow = getWorkflowTemplate(job.workflowType);
    this.addEvent(state, "change_applied", `Manager approved the ${job.outcome.replaceAll("_", " ")} result and updated the ${workflow.recordLabel.toLowerCase()}.`, job.id);
    this.store.save();
    return this.response();
  }

  reject(jobId) {
    const state = this.state();
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error("Call job not found");
    if (job.status !== "needs_review") throw new Error("Only a completed result can be rejected");
    const approval = state.approvals.find((item) => item.id === job.approvalId);
    if (approval) { approval.status = "rejected"; approval.decidedAt = this.clock(); }
    job.status = "rejected";
    job.updatedAt = this.clock();
    this.addEvent(state, "change_rejected", `Manager rejected the proposed ${getWorkflowTemplate(job.workflowType).recordLabel.toLowerCase()} change; the scheduled item remains unchanged.`, job.id);
    this.store.save();
    return this.response();
  }

  async retry(jobId) {
    const state = this.state();
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error("Call job not found");
    if (job.status !== "failed") throw new Error("Only failed calls can be retried");
    const hadProviderCall = Boolean(job.providerCallId);
    job.status = "awaiting_approval";
    job.providerCallId = null;
    job.providerStatus = null;
    job.result = null;
    job.outcome = null;
    job.evidence = [];
    job.transcript = [];
    job.failureCode = null;
    job.failureMessage = null;
    if (hadProviderCall) job.idempotencyKey = `employe_${job.id}_${crypto.randomBytes(3).toString("hex")}`;
    const previousApproval = state.approvals.find((item) => item.id === job.approvalId);
    if (previousApproval) previousApproval.decidedAt = previousApproval.decidedAt || this.clock();
    const nextApprovalId = id("approval");
    job.approvalId = nextApprovalId;
    state.approvals.unshift({ id: nextApprovalId, jobId, status: "pending", createdAt: this.clock(), decidedAt: null });
    this.addEvent(state, "call_retrying", hadProviderCall
      ? "A terminal provider failure requires a new approval and a fresh idempotency key."
      : "The failed request is ready for a new approval using the same idempotency key.", job.id);
    this.store.save();
    return this.response();
  }

  async cancel(jobId) {
    const state = this.state();
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error("Call job not found");
    if (job.status === "awaiting_approval") {
      const approval = state.approvals.find((item) => item.id === job.approvalId);
      if (approval) { approval.status = "canceled"; approval.decidedAt = this.clock(); }
      job.status = "canceled";
      this.addEvent(state, "call_canceled", "Manager canceled the preview before any call was created.", job.id);
      this.store.save();
      return this.response();
    }
    if (!job.providerCallId || !["queued", "in_progress"].includes(job.status)) throw new Error("This job cannot be canceled in its current state");
    if (typeof this.provider.cancel !== "function") throw new Error("Provider cancellation is unavailable");
    const result = await this.provider.cancel(job.providerCallId);
    job.providerStatus = result.status;
    job.status = result.status === "canceled" ? "canceled" : job.status;
    this.addEvent(state, "call_canceled", result.status === "canceled" ? "Provider call canceled." : "Provider did not confirm cancellation.", job.id);
    this.store.save();
    return this.response();
  }

  reset() {
    this.store.reset();
    return this.response();
  }
}

export const createWorkflow = (options = {}) => new CallWorkflow(options);
