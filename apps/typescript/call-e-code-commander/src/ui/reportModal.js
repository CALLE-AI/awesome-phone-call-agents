/**
 * Report & Pull Request Modal Controller
 * Formats and exports GitHub PRs, Incident Post-Mortems, and Custom Incident submissions.
 */

import { soundEngine } from '../audio/soundEngine.js';
import { auditFileName } from '../agents/auditTrail.js';

export class ReportModalController {
  constructor(options = {}) {
    this.modalEl = document.getElementById('prReportModal');
    this.modalTitleEl = document.getElementById('reportModalTitle');
    this.modalContentEl = document.getElementById('reportModalContent');
    this.closeBtn = document.getElementById('closeReportModalBtn');
    this.copyBtn = document.getElementById('copyReportBtn');
    this.downloadAuditBtn = document.getElementById('downloadAuditBtn');
    this.mergeBtn = document.getElementById('mergePrBtn');
    this.activeAudit = null;

    // Custom incident modal elements
    this.customModalEl = document.getElementById('customIncidentModal');
    this.closeCustomBtn = document.getElementById('closeCustomModalBtn');
    this.cancelCustomBtn = document.getElementById('cancelCustomBtn');
    this.submitCustomBtn = document.getElementById('submitCustomBtn');
    this.customFileNameInput = document.getElementById('customFileName');
    this.customErrorTraceInput = document.getElementById('customErrorTrace');
    this.customCodeSnippetInput = document.getElementById('customCodeSnippet');

    this.onCustomSubmit = options.onCustomSubmit || null;
    this.onMergeHotfix = options.onMergeHotfix || null;
    this.activeMarkdown = '';

    this.initEvents();
  }

  initEvents() {
    if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.hide());
    if (this.closeCustomBtn) this.closeCustomBtn.addEventListener('click', () => this.hideCustom());
    if (this.cancelCustomBtn) this.cancelCustomBtn.addEventListener('click', () => this.hideCustom());

    if (this.copyBtn) {
      this.copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(this.activeMarkdown).then(() => {
          const orig = this.copyBtn.textContent;
          this.copyBtn.textContent = '✓ Copied!';
          setTimeout(() => this.copyBtn.textContent = orig, 1800);
        });
      });
    }

    if (this.downloadAuditBtn) {
      this.downloadAuditBtn.addEventListener('click', () => this.downloadAudit());
    }

    if (this.mergeBtn) {
      this.mergeBtn.addEventListener('click', () => {
        soundEngine.playSuccessFanfare();
        this.mergeBtn.textContent = '🚀 Merging to main branch...';
        setTimeout(() => {
          this.mergeBtn.textContent = '✅ Merged & Deployed!';
          this.mergeBtn.disabled = true;
          if (this.onMergeHotfix) this.onMergeHotfix();
        }, 1200);
      });
    }

    if (this.submitCustomBtn) {
      this.submitCustomBtn.addEventListener('click', () => {
        const customData = {
          fileName: this.customFileNameInput.value,
          stackTrace: this.customErrorTraceInput.value,
          originalCode: this.customCodeSnippetInput.value
        };
        this.hideCustom();
        if (this.onCustomSubmit) this.onCustomSubmit(customData);
      });
    }
  }

  /**
   * Writes the audit record out as a file the reviewer keeps.
   *
   * A blob and an anchor, so the file never leaves the browser. The trail holds
   * the transcript of a call to a real person and the number that was dialled,
   * and posting that to a server to turn it into a download would be sending
   * exactly the data this project keeps off the wire everywhere else.
   */
  downloadAudit() {
    if (!this.activeAudit) return;

    const blob = new Blob([JSON.stringify(this.activeAudit, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = auditFileName(this.activeAudit.incidentId);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    const orig = this.downloadAuditBtn.textContent;
    this.downloadAuditBtn.textContent = '✓ Saved';
    setTimeout(() => { this.downloadAuditBtn.textContent = orig; }, 1800);
  }

  showPullRequest(scenario) {
    if (!scenario || !this.modalEl) return;

    this.modalTitleEl.textContent = `GitHub Pull Request #1402 — Hotfix for ${scenario.service}`;
    // The post-mortem view hides this button, so restore it when reopening the PR.
    this.mergeBtn.style.display = '';
    this.downloadAuditBtn?.classList.add('hidden');
    this.mergeBtn.disabled = false;
    this.mergeBtn.textContent = '🚀 Approve & Auto-Merge Hotfix';

    this.activeMarkdown = `### 🚨 CALL-E Autonomous Hotfix: ${scenario.title}
**Branch**: \`hotfix/calle-remediation-${scenario.id}\` &bull; **Target**: \`main\`
**Author**: CALL-E Autonomous Council (4 Agents) &bull; **Severity**: \`${scenario.severity}\`

---

#### 🔍 Root Cause Analysis (Inspector Tracer)
- **Root Cause**: ${scenario.rcaReport.rootCause}
- **Vulnerability Class**: \`${scenario.rcaReport.vulnerabilityClass}\`
- **Offending Commit**: \`${scenario.rcaReport.offendingCommit}\`

#### ⚡ Proposed Architectural Fix (Patch Architect)
- Applied atomic database transaction row lock with PostgreSQL \`FOR UPDATE\`.
- Introduced distributed Redis mutex key with strict 15s TTL.
- Enforced cryptographic idempotency key verification.

#### 🛡️ SRE Verification & Quality Gate (Quality Guardian)
- ✅ 12/12 Automated regression unit & integration tests passing.
- ✅ Zero socket or memory descriptor leaks observed in isolated sandbox.
- ✅ Rollback checkpoint tagged at release commit \`tag-hotfix-pre-${Date.now()}\`.

---
*Generated by CALL-E: Your Code Is Calling*`;

    this.modalContentEl.innerHTML = `
      <div class="pr-preview-wrap">
        <p><strong>Branch:</strong> <code>hotfix/calle-${scenario.id}</code> &rarr; <code>main</code></p>
        <p><strong>Reviewing Council:</strong> CALL-E Operator, Inspector Tracer, Patch Architect, Quality Guardian</p>
        <br/>
        <h4>🔍 Root Cause Summary</h4>
        <p>${scenario.rcaReport.rootCause}</p>
        <br/>
        <h4>⚡ Applied Solution</h4>
        <p>${scenario.rcaReport.recommendedFix}</p>
        <br/>
        <h4>🛡️ QA Sandbox Status</h4>
        <p style="color: var(--green); font-weight: 700;">✓ 100% Sandbox Assertions Passed (Zero Regressions)</p>
        <br/>
        <h4>Diff Summary</h4>
        <pre><code>${(scenario.diff || []).slice(0, 8).map(d => d.text).join('\n')}...</code></pre>
      </div>
    `;

    this.modalEl.classList.remove('hidden');
  }

  /**
   * Renders the post-incident review.
   *
   * The authorisation trail matters as much as the root cause here. A reviewer
   * needs to see who authorised the production change, on which phone number,
   * in their own words, and how confident CALL-E was that it heard them right.
   */
  showRcaReport(scenario, outcome = null, audit = null) {
    if (!scenario || !this.modalEl) return;

    this.modalTitleEl.textContent = `📑 Incident Post-Mortem: ${scenario.service}`;
    this.mergeBtn.style.display = 'none';

    // Offered only when there is a trail to download. A button that exports an
    // empty file is worse than no button.
    this.activeAudit = audit;
    this.downloadAuditBtn?.classList.toggle('hidden', !audit);

    const trailMarkdown = buildAuthorisationTrail(outcome, 'markdown');
    const trailHtml = buildAuthorisationTrail(outcome, 'html');

    this.activeMarkdown = `# INCIDENT POST-MORTEM: ${scenario.title}
**Date**: ${new Date().toLocaleDateString()}
**Severity**: ${scenario.severity}
**Affected service**: ${scenario.service}
**Detection method**: CALL-E outbound voice page to the on-call rota

## 1. Summary
Automated monitoring detected a critical anomaly in ${scenario.service}. The incident council isolated a root cause, staged a hotfix, and verified it in an isolated sandbox. CALL-E then paged the on-call rota by phone to obtain a human authorisation before any production change.

## 2. Root cause
${scenario.rcaReport.rootCause}

- Fault class: ${scenario.rcaReport.vulnerabilityClass}
- Attributed commit: ${scenario.rcaReport.offendingCommit}

## 3. Authorisation trail
${trailMarkdown}

## 4. Resolution
${scenario.rcaReport.recommendedFix}

## 5. Follow-up actions
- Enforce static analysis rules for concurrency synchronisation on this service.
- Add integration coverage for duplicate retry payloads.
- Review whether the rung that answered should be the primary on this rota.
`;

    this.modalContentEl.innerHTML = `
      <div class="pr-preview-wrap">
        <h3>Post-mortem: ${scenario.title}</h3>
        <p><strong>Affected service:</strong> ${scenario.service} &bull; <strong>Severity:</strong> ${scenario.severity}</p>
        <br/>
        <h4>Incident description</h4>
        <p>${scenario.impact}</p>
        <br/>
        <h4>Root cause</h4>
        <p>${scenario.rcaReport.rootCause}</p>
        <br/>
        <h4>Authorisation trail</h4>
        ${trailHtml}
        <br/>
        <h4>Long-term prevention</h4>
        <p>${scenario.rcaReport.recommendedFix}</p>
      </div>
    `;

    this.modalEl.classList.remove('hidden');
  }

  showCustom() {
    if (this.customModalEl) this.customModalEl.classList.remove('hidden');
  }

  hide() {
    if (this.modalEl) this.modalEl.classList.add('hidden');
  }

  hideCustom() {
    if (this.customModalEl) this.customModalEl.classList.add('hidden');
  }
}

/**
 * Formats the escalation ladder result as an auditable trail.
 *
 * Renders every rung that was dialled, not just the one that answered, because
 * "the primary did not pick up at 03:12" is the finding most rota reviews need.
 */
function buildAuthorisationTrail(outcome, format) {
  const md = format === 'markdown';

  if (!outcome) {
    const text = 'No phone authorisation was obtained for this incident. The hotfix was not applied to production by the council.';
    return md ? text : `<p>${text}</p>`;
  }

  const lines = [];
  const decision = DECISION_LABELS[outcome.decision] || 'No decision recorded';
  const by = outcome.decidedBy?.name || 'nobody on the rota';
  const channel = outcome.channel === 'console' ? 'the web console' : 'a CALL-E phone call';

  lines.push(md
    ? `**Outcome**: ${decision}, authorised by ${by} via ${channel}.`
    : `<p><strong>Outcome:</strong> ${decision}, authorised by ${by} via ${channel}.</p>`);

  if (outcome.reason) {
    lines.push(md ? `**Stated reason**: "${outcome.reason}"` : `<p><strong>Stated reason:</strong> "${outcome.reason}"</p>`);
  }

  if (typeof outcome.confidence === 'number') {
    const pct = `${(outcome.confidence * 100).toFixed(0)}%`;
    lines.push(md
      ? `**CALL-E extraction confidence**: ${pct}`
      : `<p><strong>CALL-E extraction confidence:</strong> ${pct}</p>`);
  }

  // The number every review asks for. Measured from the page being raised, so
  // an unanswered first rung counts against it, which is the honest reading:
  // production was undecided for that whole time.
  if (typeof outcome.elapsedMs === 'number') {
    const elapsed = formatDuration(outcome.elapsedMs);
    lines.push(md
      ? `**Time from page raised to human decision**: ${elapsed}`
      : `<p><strong>Time from page raised to human decision:</strong> ${elapsed}</p>`);
  }

  const rungs = outcome.rungs || [];
  if (rungs.length > 0) {
    const rows = rungs.map((rung, i) => {
      const reached = rung.outcome?.reachedEngineer ? 'answered' : 'no answer';
      const call = rung.callId ? ` (call ${rung.callId})` : rung.mode === 'simulated' ? ' (simulated)' : '';
      // A second call to the same person is not a redial. It happened because
      // they asked for it, and the trail has to say so or the rota looks like
      // it was pestered.
      const attempt = (rung.attempt ?? 1) > 1 ? ' — agreed callback' : '';
      const deferred = rung.callback
        ? ` — asked for ${rung.callback.requestedMinutes} min${rung.callback.endedBy === 'skipped' ? ', called back early by the operator' : ''}`
        : '';
      const took = typeof rung.durationMs === 'number' ? ` [${formatDuration(rung.durationMs)}]` : '';
      const text = `${rung.contact?.name || 'Unknown'} — ${reached}${attempt}${deferred}${call}${took}`;
      return md ? `${i + 1}. ${text}` : `<li>${text}</li>`;
    });
    lines.push(md ? `\n**Rungs dialled**\n${rows.join('\n')}` : `<p><strong>Rungs dialled:</strong></p><ol>${rows.join('')}</ol>`);
  }

  return lines.join(md ? '\n\n' : '');
}

/** Duration in the units a person writing up an incident would use. */
function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'not measured';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} seconds`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} minutes` : `${minutes} minutes ${seconds} seconds`;
}

const DECISION_LABELS = {
  deploy_hotfix: 'Deploy the verified hotfix',
  hold_for_review: 'Hold the hotfix for human review',
  rollback_release: 'Roll back the last release',
  escalate_to_backup: 'Escalate to the backup on-call',
  no_decision: 'No decision recorded'
};
