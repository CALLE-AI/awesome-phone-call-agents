import './styles.css';
import './workshop-layout.css';
import './replay.css';
import { DATE_KINDS, DATE_LABELS, formatDate } from './domain/workshop-outcome';
import { readWorkshopReplay, ReplayError, type VerifiedWorkshopReplay } from './domain/workshop-replay';
import { WORKSHOP_SCENARIOS } from './fixtures/workshop';
import { WORKSHOP_REPLAY_BYTES, WORKSHOP_REPLAY_SHA256 } from './fixtures/workshop-replay-catalog';

const found = document.querySelector<HTMLDivElement>('#app');
if (found === null) throw new Error('Application root is missing.');
const app = found;
const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value: string): string => value.replace(/[&<>"']/gu, (char) => escapes[char] ?? '');
const shell = (body: string): string => `<a class="skip-link" href="#main">Skip to content</a><header class="app-header"><a class="brand" href="/"><img class="brand-mark" src="/favicon.svg" width="32" height="32" alt="" />CallOps</a><span class="pill neutral">Synthetic replay fixtures</span></header><div class="app-shell"><main id="main" tabindex="-1">${body}</main><footer class="replay-footer"><a href="/">Try the interactive workshop</a><a href="/THIRD_PARTY_NOTICES.txt">Third-party notices</a><span>Local candidate · No real call evidence included</span></footer></div>`;
app.innerHTML = shell('<div class="page-heading" role="status"><h1>Checking the bundled evidence…</h1><p>The reader opens only after its integrity and format checks pass.</p></div>');

function render(replay: VerifiedWorkshopReplay, index: number, focus = false): void {
  const scenario = replay.scenarios[index];
  if (scenario === undefined) return;
  const result = scenario.outcome;
  const label = WORKSHOP_SCENARIOS.find((item) => item.id === scenario.id)?.label ?? '';
  const links = (ids: readonly string[]): string => ids.map((id) => `<a href="#${id}" data-source="${id}">${esc(id)}</a>`).join(' · ');
  app.innerHTML = shell(`<div class="page-heading"><span class="eyebrow">EVIDENCE READER</span><h1>See what supports the update.</h1><p>Four scripted outcomes for one fictional repair. Read the result and follow each source.</p></div>
    <section class="panel replay-context" id="CASE" tabindex="-1"><span class="eyebrow">THE SAME WORKSHOP CASE</span><h2>A pump is due. Is the machine due back?</h2><p>Fieldwork Repairs Demo previously expected the espresso machine to return to its customer on <strong>Friday, 11 September 2026</strong>. The supplier is Northstar Parts Demo. Reference: ${replay.caseReference}.</p><p class="caption">CASE is a fictional workshop expectation, not a supplier promise. Scenario observation time: 8 September 2026, 12:00 Europe/Paris.</p></section>
    <nav class="replay-nav" aria-label="Bundled fictional outcomes">${WORKSHOP_SCENARIOS.map((item, i) => `<button class="secondary" data-scenario="${i}" aria-pressed="${i === index}">${esc(item.label)}</button>`).join('')}</nav>
    <section id="replay-result" tabindex="-1" aria-label="Selected outcome"><span class="eyebrow">${esc(label)}</span><div class="verdict ${result.expectation === 'SUPPORTED' ? 'positive' : 'attention'}"><div class="verdict-symbol" aria-hidden="true">${result.expectation === 'SUPPORTED' ? '✓' : '!'}</div><div><h2>${esc(result.headline)}</h2><p>${esc(result.explanation)}</p></div></div>
    <div class="date-grid">${DATE_KINDS.map((kind) => {
      const finding = result.dates[kind];
      const qualification = { CONFIRMED: 'Confirmed', ESTIMATED: 'Estimated', UNKNOWN: 'Not confirmed', AMBIGUOUS: 'Needs clarification', CONFLICTING: 'Conflicting dates' }[finding.qualification];
      return `<section class="date-card ${kind === 'DEVICE_RETURN' ? 'return-card' : ''}" data-kind="${kind}"><h3>${DATE_LABELS[kind]}</h3><strong>${finding.date === null ? '—' : esc(formatDate(finding.date))}</strong><span class="pill ${finding.qualification === 'CONFIRMED' ? 'success' : 'neutral'}">${qualification}</span><div class="evidence-links">${finding.evidence.length ? links(finding.evidence.map((e) => e.id)) : 'No supporting date'}</div></section>`;
    }).join('')}</div>
    <section class="panel replay-draft"><span class="eyebrow">SUGGESTED CUSTOMER UPDATE</span><h2>Every sentence has a source.</h2>${result.draft.map((sentence) => `<div><p>${esc(sentence.text)}</p><span class="caption">Sources: ${links(sentence.evidenceIds)}</span></div>`).join('')}<p class="caption">Read-only suggestion derived from the bundled transcript. Nothing is sent. Use the interactive workshop to edit a draft.</p></section>
    <details class="panel replay-evidence" id="evidence"><summary>Read the scripted transcript (${result.evidence.length} excerpts)</summary><ol class="transcript">${result.evidence.map((item) => `<li id="${item.id}" tabindex="-1"><span class="source-tag">${item.id}</span><p>${esc(item.text)}</p></li>`).join('')}</ol><p class="caption">${result.unclassified.length} excerpt(s) outside the limited interpretation vocabulary.</p></details>
    <section class="panel replay-context"><h2>Other source references</h2><p id="RUN" tabindex="-1">RUN: the scripted outcome is ${scenario.state === 'FAILED' ? 'unreachable; no supplier facts were obtained' : 'completed'}. This is not a provider execution record.</p><p id="REVIEW" tabindex="-1">REVIEW denotes an absence of supporting confirmation. It is cited only when the reviewed response does not establish a confirmed return date.</p></section></section>
    <details class="panel replay-provenance"><summary>Integrity, provenance and limits</summary><dl><div><dt>Mode</dt><dd>SYNTHETIC_REPLAY_FIXTURE · no real call took place</dd></div><div><dt>Integrity</dt><dd>Verified against the hash bundled with this build. SHA-256: ${replay.sha256}</dd></div><div><dt>Fixture origin</dt><dd>src/fixtures/workshop.ts at ${replay.fixtureSourceCommit}. Revision ${replay.fixtureRevision}, schema ${replay.schemaVersion}.</dd></div><div><dt>Service evidence</dt><dd>0 service requests · 0 phone calls · current server contracts unobserved</dd></div><div><dt>What this check means</dt><dd>The hash detects changes to these curated bytes. It is not a signature, independent authenticity check, or proof of a real call. This reader does not accept uploads or remote replay URLs.</dd></div><div><dt>Interpretation</dt><dd>Dates and suggestions are computed using a bounded deterministic demo vocabulary. This does not qualify free-form real conversations. A real, sanitized replay requires separate capture, review and qualification.</dd></div></dl></details>`);
  app.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button) => button.addEventListener('click', () => render(replay, Number(button.dataset.scenario), true)));
  app.querySelectorAll<HTMLAnchorElement>('[data-source]').forEach((anchor) => anchor.addEventListener('click', () => {
    const id = anchor.dataset.source ?? '';
    if (/^E\d+$/u.test(id)) { const details = app.querySelector<HTMLDetailsElement>('#evidence'); if (details !== null) details.open = true; }
    document.getElementById(id)?.focus();
  }));
  if (focus) app.querySelector<HTMLElement>('#replay-result')?.focus({ preventScroll: true });
}

try { render(await readWorkshopReplay(WORKSHOP_REPLAY_BYTES, WORKSHOP_REPLAY_SHA256), 0); }
catch (error) {
  const code = error instanceof ReplayError ? error.code : 'REPLAY_UNAVAILABLE';
  app.innerHTML = shell(`<section class="panel replay-error" role="alert"><h1>The replay could not be verified.</h1><p>No outcome was loaded. Use an intact local candidate with a supported browser.</p><p class="caption">${esc(code)}</p></section>`);
}
