import './styles.css';
import './workshop-layout.css';
import { InMemoryRepository } from './adapters/in-memory-repository';
import { LocalStorageRepository } from './adapters/local-storage-repository';
import { WorkshopMockCallProvider } from './adapters/workshop-mock-call-provider';
import { WorkshopOutcomeExtractor } from './adapters/workshop-outcome-extractor';
import { CallOpsService } from './application/callops-service';
import { EMPTY_SNAPSHOT, type CallOpsSnapshot, type MockScenario } from './domain/models';
import { DATE_KINDS, DATE_LABELS, formatDate, interpretWorkshopTranscript, type WorkshopOutcome } from './domain/workshop-outcome';
import { WORKSHOP_CASE, WORKSHOP_CONTEXT, WORKSHOP_SCENARIOS } from './fixtures/workshop';
import type { CaseRepository } from './ports/case-repository';
import { SystemClock } from './ports/clock';

const found = document.querySelector<HTMLDivElement>('#app');
if (found === null) throw new Error('Application root is missing.');
const app = found;
let repository: CaseRepository = new LocalStorageRepository(undefined, 'workshop');
let snapshot: CallOpsSnapshot = structuredClone(EMPTY_SNAPSHOT);
let storageBlocked = false;
let temporary = false;
try {
  snapshot = await repository.load();
  if (snapshot.supportCase !== null && Object.entries(WORKSHOP_CASE).some(([key, value]) =>
    JSON.stringify(snapshot.supportCase?.[key as keyof typeof WORKSHOP_CASE]) !== JSON.stringify(value))) throw new Error('Different case.');
} catch { storageBlocked = true; snapshot = structuredClone(EMPTY_SNAPSHOT); }
let service = makeService();
let selectedScenario: MockScenario = snapshot.run?.scenario ?? 'AMBIGUOUS';
let busy = false;
let notice = '';
let actionFailed = false;
let draftEdit: string | null = null;
const EXTRA_QUESTION = 'Can you distinguish the part-arrival date from the device-return date once more?';
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value: string): string => value.replace(/[&<>"']/gu, (char) => ESCAPES[char] ?? '');

function makeService(): CallOpsService {
  return new CallOpsService(repository, new WorkshopMockCallProvider(snapshot.run), new WorkshopOutcomeExtractor(), new SystemClock());
}
function step(): number { return snapshot.outcome !== null ? 3 : snapshot.plan !== null ? 2 : 1; }
function pill(text: string, tone = ''): string { return `<span class="pill ${tone}">${esc(text)}</span>`; }
function list(values: readonly string[], ordered = false): string {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag} class="${ordered ? 'questions' : 'plain-list'}">${values.map((value) => `<li>${esc(value)}</li>`).join('')}</${tag}>`;
}
function caseView(): string {
  return `<div class="page-heading"><span class="eyebrow">THE WORKSHOP DESK</span><h1>Follow up with confidence.</h1><p>Get the supplier’s facts. Know what you can tell your customer.</p></div>
    <div class="case-layout"><section class="panel case-panel" aria-labelledby="case-title">
      <div class="section-top"><span class="eyebrow">REPAIR CASE</span>${pill('Awaiting a part', 'neutral')}</div>
      <div class="equipment"><div class="equipment-icon" aria-hidden="true">◧</div><div><h2 id="case-title">Espresso machine</h2><p class="muted">Replacement pump · ${esc(WORKSHOP_CASE.syntheticReference)}</p></div></div>
      <dl class="case-facts"><div><dt>Workshop</dt><dd>Fieldwork Repairs Demo</dd></div><div><dt>Supplier</dt><dd>Northstar Parts Demo</dd></div></dl>
      <div class="expectation-box"><span class="eyebrow">ALREADY SHARED WITH THE CUSTOMER</span><p>“We expect your machine back on <strong>Friday, 11 September.</strong>”</p><span class="caption">Workshop expectation · to be checked with the supplier</span></div>
      <h3>What we need to find out</h3><div class="question-grid"><div><span>01</span>When does the part arrive?</div><div><span>02</span>When is the repair complete?</div><div><span>03</span>When does the device return?</div><div><span>04</span>When is the next update?</div></div>
      <div class="panel-footer"><span class="caption">Fictional case · fixed details for this prototype</span><button class="primary" data-action="prepare">Review the call <span aria-hidden="true">→</span></button></div>
    </section><aside class="scenario-panel" aria-labelledby="scenario-title"><span class="eyebrow">EXPLORE THE DEMO</span><h2 id="scenario-title">Try a supplier response</h2><p class="muted">The same case, four possible outcomes.</p><fieldset class="scenario-options"><legend class="sr-only">Fictional supplier response</legend>${WORKSHOP_SCENARIOS.map((scenario, i) => `<label class="scenario-option"><input type="radio" name="scenario" value="${scenario.id}" ${selectedScenario === scenario.id ? 'checked' : ''}><span><strong>${esc(scenario.label)}</strong><small>${esc(scenario.description)}</small>${i === 0 ? '<em>Start here</em>' : ''}</span></label>`).join('')}</fieldset><div class="small-note"><span aria-hidden="true">↳</span><p>No call is placed. Supplier responses are scripted and interpreted with deterministic rules.</p></div></aside></div>`;
}

function reviewView(): string {
  const plan = snapshot.plan;
  if (plan === null) return '';
  const state = snapshot.run?.state;
  const approved = state === 'APPROVED';
  const waiting = state === 'WAITING_FOR_APPROVAL';
  const running = state === 'QUEUED' || state === 'IN_PROGRESS';
  return `<div class="page-heading"><span class="eyebrow">CALL REVIEW</span><h1>A clear brief, before the call.</h1><p>Review the questions and exactly what the assistant may share.</p></div>
    <div class="review-layout"><section class="panel"><div class="section-top"><h2>Ask Northstar Parts Demo</h2>${pill('Simulation', 'neutral')}</div><p class="muted">Espresso machine · ${esc(WORKSHOP_CASE.syntheticReference)}</p>${list(plan.plannedQuestions, true)}
      ${waiting || approved ? `<button class="text-button" data-action="revise">${plan.plannedQuestions.includes(EXTRA_QUESTION) ? 'Remove the extra clarification' : '+ Add an extra date clarification'}</button>` : ''}
      <details class="details"><summary>Opening and closing brief</summary>${list(plan.proposedScript)}</details>
    </section><div class="review-right"><section class="panel"><h2>Information to share</h2><p class="caption">Approval applies to these exact details.</p>${list(plan.transmittedData)}<details class="details"><summary>Limits and stopping conditions</summary>${list([...plan.prohibitedBehaviors, ...plan.stopConditions])}</details></section>
      <section class="approval-card"><span class="eyebrow">YOUR CONTROL</span><h2>${running ? 'Simulation in progress' : approved ? 'This brief is approved' : state === 'REJECTED' ? 'The brief was rejected' : 'Approve this brief'}</h2>
      ${waiting ? `<label class="approval-check"><input id="approval-check" type="checkbox"><span>I approve these questions and the information shown for this simulation.</span></label><button class="primary full" data-action="approve" disabled>Approve brief</button><button class="text-button full" data-action="reject">Reject brief</button>` : ''}
      ${approved ? '<p>Your approval is tied to this version. Changing a question requires approval again.</p><button class="primary full" data-action="start">Run simulation <span aria-hidden="true">→</span></button>' : ''}
      ${running ? `<div class="progress-track" aria-hidden="true"><span class="${state === 'IN_PROGRESS' ? 'advanced' : ''}"></span></div><p>${state === 'QUEUED' ? 'The approved simulation is queued.' : 'The fictional supplier response is ready to interpret.'}</p><button class="primary full" data-action="advance">${state === 'QUEUED' ? 'Read supplier response' : 'View the result'} <span aria-hidden="true">→</span></button><p class="caption">Two manual steps in this prototype. Reloading resumes here.</p>` : ''}
      ${state === 'REJECTED' ? '<p>No simulation started. Prepare a new brief when ready.</p><button class="primary full" data-action="reset">Back to the case</button>' : ''}
      <p class="caption">No phone call · no customer message · no automatic retry</p></section></div></div>`;
}

function resultView(result: WorkshopOutcome): string {
  const supported = result.expectation === 'SUPPORTED';
  const draft = result.draft.map((sentence) => sentence.text).join('\n\n');
  return `<div class="page-heading result-heading"><div><span class="eyebrow">SUPPLIER UPDATE</span><h1>Know what you can promise.</h1><p>Espresso machine · ${esc(WORKSHOP_CASE.syntheticReference)}</p></div>${pill('Scripted response · UI-02', 'neutral')}</div>
    <section class="verdict ${supported ? 'positive' : 'attention'}"><div class="verdict-symbol" aria-hidden="true">${supported ? '✓' : result.expectation === 'CONFLICTING' ? '≠' : '?'}</div><div><span class="eyebrow">${supported ? 'EXPECTATION SUPPORTED' : 'REVIEW BEFORE SHARING'}</span><h2>${esc(result.headline)}</h2><p>${esc(result.explanation)}</p></div></section>
    <div class="date-grid">${DATE_KINDS.map((kind) => {
      const finding = result.dates[kind];
      const label = finding.qualification === 'UNKNOWN' ? 'Not confirmed' : finding.qualification === 'CONFLICTING' ? 'Conflicting dates' : finding.qualification === 'AMBIGUOUS' ? 'Needs clarification' : finding.qualification === 'ESTIMATED' ? 'Estimated' : 'Confirmed';
      return `<section class="date-card ${kind === 'DEVICE_RETURN' ? 'return-card' : ''}"><h3>${DATE_LABELS[kind]}</h3><strong>${finding.date === null ? '—' : esc(formatDate(finding.date))}</strong>${pill(label, finding.qualification === 'CONFIRMED' ? 'success' : 'neutral')}<div class="evidence-links">${finding.evidence.length ? finding.evidence.map((item) => `<a href="#${item.id}" data-evidence="${item.id}" aria-label="Evidence ${item.id} for ${DATE_LABELS[kind]}">${item.id} ↗</a>`).join(' ') : '<span>No supporting date</span>'}</div></section>`;
    }).join('')}</div>
    <div class="result-layout"><section class="panel draft-panel"><div class="section-top"><div><span class="eyebrow">CUSTOMER UPDATE</span><h2>A draft you can stand behind.</h2></div>${pill('Draft only', 'neutral')}</div><label for="customer-draft" class="caption">Edit the wording, then copy it when you’re ready.</label><textarea id="customer-draft" maxlength="4000" spellcheck="true">${esc(draftEdit ?? draft)}</textarea><div id="draft-status" class="caption" aria-live="polite">${draftEdit === null ? 'Suggested from the evidence below. Nothing has been sent.' : 'Edited by you. Check every detail before sharing; nothing has been sent.'}</div><div class="draft-actions"><button class="text-button" data-action="restore-draft">Restore suggestion</button><button class="primary" data-action="copy">Copy customer update <span aria-hidden="true">↗</span></button></div><p class="caption">Edits stay in this tab and are cleared by reload or a new simulation.</p><details class="details"><summary>What supports this suggestion?</summary><ul class="plain-list">${result.draft.map((sentence) => `<li>${esc(sentence.text)} <span class="source-tag">${esc(sentence.evidenceIds.join(', '))}</span></li>`).join('')}</ul><p class="caption">CASE: workshop expectation. RUN: simulation outcome. REVIEW: no supporting return statement in the reviewed response. Evidence references describe the original suggestion, not your edits.</p></details></section>
    <aside class="result-aside"><section class="panel"><span class="eyebrow">CUSTOMER EXPECTATION</span><h2>${esc(formatDate(WORKSHOP_CONTEXT.customerExpectedReturn))}</h2><p>Device returned to the customer</p>${pill(supported ? 'Supported by supplier' : result.expectation === 'CONFLICTING' ? 'Needs clarification' : 'Not confirmed as promised', supported ? 'success' : 'neutral')}<p class="caption">Previously shared by the workshop. This is a case fact, separate from supplier evidence.</p></section><section class="next-action"><span class="eyebrow">SUGGESTED NEXT STEP</span><h3>${supported ? 'Review and share the update.' : !result.reached ? 'Choose when to follow up.' : result.expectation === 'CONFLICTING' ? 'Clarify the conflicting dates.' : 'Ask for a device-return date.'}</h3><p>${supported ? 'Keep the supplier’s date attached to the device return.' : 'A human decides the next action. Nothing is scheduled automatically.'}</p></section></aside></div>
    <details class="panel evidence-panel" id="supplier-evidence"><summary><span>Supplier evidence</span><span class="caption">${result.evidence.length} transcript excerpts · fictional scenario dated 8 Sep 2026</span></summary><ol class="transcript">${result.evidence.map((item) => `<li id="${item.id}" tabindex="-1"><span class="source-tag">${item.id}</span><p>${esc(item.text)}</p></li>`).join('')}</ol>${result.unclassified.length ? `<p class="caption">${result.unclassified.length} excerpt(s) could not be interpreted safely and need review.</p>` : ''}</details>
    <details class="details technical"><summary>About this prototype and its local history</summary><p>UI-02 · MOCK · four closed fictional scenarios. Dates and drafts use a limited, deterministic demo vocabulary. This is not evidence of a real supplier call or a general conversation parser.</p><p>The browser saves simulation progress only. Its local history is not tamper-proof. Customer-draft edits are not saved. No live connection is included.</p><p>${snapshot.audit.length} recorded state changes. ${result.repairComplete ? 'The supplier says the repair is complete.' : 'Repair completion is not established as complete.'}</p><button class="text-button" data-action="export">Download local audit</button></details>`;
}

function render(): void {
  const current = step();
  let result: WorkshopOutcome | null = null;
  if (snapshot.run !== null && (snapshot.run.state === 'COMPLETED' || snapshot.run.state === 'FAILED')) result = interpretWorkshopTranscript(snapshot.run.transcript, snapshot.run.state, WORKSHOP_CONTEXT);
  app.innerHTML = `<a class="skip-link" href="#main">Skip to content</a><header class="app-header"><a class="brand" href="#main" aria-label="CallOps workshop desk"><img class="brand-mark" src="/favicon.svg" width="32" height="32" alt="" />CallOps<span class="brand-divider"></span><span class="brand-context">Workshop desk</span></a><div class="header-actions">${pill('● Simulation', 'simulation')}<span class="version">UI-02</span>${current > 1 ? '<button class="secondary compact" data-action="reset">New simulation</button>' : ''}</div></header>
    <div class="app-shell"><nav class="steps" aria-label="Case progress"><ol>${['Case', 'Call review', 'Result'].map((label, i) => `<li ${current === i + 1 ? 'aria-current="step"' : ''} class="${current > i + 1 ? 'done' : ''}"><span>${current > i + 1 ? '✓' : `0${i + 1}`}</span>${label}</li>`).join('')}</ol><span class="caption">${temporary ? 'Temporary session' : 'Progress saved in this browser'}</span></nav>
    <div class="notice" role="status" ${notice ? '' : 'hidden'}>${esc(notice)}${actionFailed && !temporary && !storageBlocked ? '<button class="text-button full" data-action="temporary">Use a temporary session</button>' : ''}</div><main id="main" tabindex="-1">${storageBlocked ? '<section class="panel recovery"><h1>Your saved session needs attention.</h1><p>It could not be loaded safely. Clear this workshop’s saved simulation or explore a temporary session.</p><button class="primary" data-action="clear-storage">Clear workshop session</button><button class="secondary" data-action="temporary">Use a temporary session</button></section>' : result !== null ? resultView(result) : current === 2 ? reviewView() : caseView()}</main><footer class="app-footer"><span>CallOps <span aria-hidden="true">/</span> Less chasing. Clearer customer updates.</span><span><a href="/replay.html">Evidence reader</a> · <a href="/THIRD_PARTY_NOTICES.txt">Notices</a></span><span>Fictional data only · No call or message is sent</span></footer></div>`;
  if (busy) app.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach((element) => { element.disabled = true; });
  app.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => button.addEventListener('click', () => { void act(button.dataset.action ?? ''); }));
  app.querySelectorAll<HTMLInputElement>('input[name="scenario"]').forEach((input) => input.addEventListener('change', () => { if (WORKSHOP_SCENARIOS.some((item) => item.id === input.value)) selectedScenario = input.value as MockScenario; }));
  app.querySelector('#approval-check')?.addEventListener('change', (event) => {
    const button = app.querySelector<HTMLButtonElement>('[data-action="approve"]');
    if (button !== null && event.target instanceof HTMLInputElement) button.disabled = !event.target.checked || busy;
  });
  app.querySelector<HTMLTextAreaElement>('#customer-draft')?.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLTextAreaElement)) return;
    draftEdit = event.target.value;
    const status = app.querySelector('#draft-status');
    if (status !== null) status.textContent = 'Edited by you. Check every detail before sharing; nothing has been sent.';
  });
  app.querySelectorAll<HTMLAnchorElement>('[data-evidence]').forEach((anchor) => anchor.addEventListener('click', () => {
    const details = app.querySelector<HTMLDetailsElement>('#supplier-evidence');
    if (details !== null) details.open = true;
    app.querySelector<HTMLElement>(`#${anchor.dataset.evidence ?? ''}`)?.focus();
  }));
}

async function act(action: string): Promise<void> {
  if (busy) return;
  // Clipboard writes retain the original click activation.
  if (action === 'copy') {
    const textarea = app.querySelector<HTMLTextAreaElement>('#customer-draft');
    if (textarea === null) return;
    try { await navigator.clipboard.writeText(textarea.value); notice = 'Customer update copied. Nothing was sent.'; }
    catch { textarea.select(); const status = app.querySelector('#draft-status'); if (status !== null) status.textContent = 'Copy is unavailable here. The draft is selected; use your keyboard to copy it.'; return; }
    const status = app.querySelector('#draft-status');
    if (status !== null) status.textContent = notice;
    return;
  }
  if (action === 'approve' && !app.querySelector<HTMLInputElement>('#approval-check')?.checked) return;
  busy = true;
  notice = '';
  actionFailed = false;
  render();
  try {
    if (action === 'prepare') {
      snapshot = await service.reset();
      service = makeService();
      await service.createSupportCase(WORKSHOP_CASE);
      snapshot = await service.createPlan(selectedScenario);
    } else if (action === 'approve' || action === 'reject') {
      snapshot = await service.recordApproval(action === 'approve' ? 'APPROVED' : 'REJECTED', action === 'approve' ? snapshot.plan?.transmittedData ?? [] : []);
    } else if (action === 'revise') {
      snapshot = await service.revisePlan((plan) => ({ ...plan, plannedQuestions: plan.plannedQuestions.includes(EXTRA_QUESTION) ? plan.plannedQuestions.filter((question) => question !== EXTRA_QUESTION) : [...plan.plannedQuestions, EXTRA_QUESTION] }));
      notice = 'The brief changed. Review and approve this version before running it.';
    } else if (action === 'start') snapshot = await service.startApprovedSimulation();
    else if (action === 'advance') snapshot = await service.advanceSimulation();
    else if (action === 'reset' || action === 'clear-storage') {
      snapshot = await service.reset(); storageBlocked = false; draftEdit = null; service = makeService();
    } else if (action === 'temporary') {
      repository = new InMemoryRepository(); snapshot = structuredClone(EMPTY_SNAPSHOT); storageBlocked = false; temporary = true; service = makeService();
    } else if (action === 'restore-draft') draftEdit = null;
    else if (action === 'export') {
      const url = URL.createObjectURL(new Blob([await service.exportSanitizedAudit()], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'callops-ui-01-local-audit.json'; link.click(); setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
    }
  } catch {
    actionFailed = true;
    notice = 'This action could not be completed. No retry was started. Reload to inspect the saved state, or start a temporary session if storage is unavailable.';
  } finally {
    busy = false;
    render();
    app.querySelector<HTMLElement>('#main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

render();
