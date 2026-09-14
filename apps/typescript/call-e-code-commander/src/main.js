/**
 * CALL-E Code Commander — Application Orchestrator
 *
 * Ties the incident pipeline to the phone. The council can investigate, patch,
 * and verify on its own, but it cannot change production. Only a decision
 * extracted from a real CALL-E phone conversation can do that.
 */

import { soundEngine } from './audio/soundEngine.js';
import { speechEngine } from './audio/speechEngine.js';
import { OrbVisualizer } from './canvas/orbVisualizer.js';
import { INCIDENT_SCENARIOS } from './data/scenarios.js';
import { AgentMesh } from './agents/agentMesh.js';
import { CallModalController } from './ui/callModal.js';
import { WarRoomController } from './ui/warRoom.js';
import { CodeDiffViewer } from './ui/codeDiffViewer.js';
import { TerminalSandbox } from './ui/terminalSandbox.js';
import { ReportModalController } from './ui/reportModal.js';
import { calleService, CalleIncidentCommander, INCIDENT_DECISION_SCHEMA, isPersonName, hasRecipientTurn } from './agents/calleService.js';
import { EscalationLadder } from './agents/escalationLadder.js';
import { buildAuditRecord } from './agents/auditTrail.js';
import { scanCode, primaryFinding, buildAnnotatedDiff, describeScan } from './agents/codeScanner.js';

const ROTA_STORAGE_KEY = 'calle_rota_v2';
const IN_FLIGHT_STORAGE_KEY = 'calle_in_flight_call';

class CallEApp {
  constructor() {
    this.currentScenarioKey = 'fintech-race';
    this.currentScenario = INCIDENT_SCENARIOS[this.currentScenarioKey];
    this.callTimerInterval = null;
    this.callDurationSec = 0;
    this.incidentId = this.newIncidentId();
    this.ladder = null;
    this.eventPollTimer = null;
    this.seenEventIds = new Set();

    this.cacheDom();
    this.restoreOperatorSettings();

    this.orb = new OrbVisualizer('orbCanvas');
    this.warRoom = new WarRoomController();
    this.codeViewer = new CodeDiffViewer();
    this.terminal = new TerminalSandbox();
    this.reportModal = new ReportModalController({
      onCustomSubmit: (customData) => this.handleCustomIncident(customData),
      onMergeHotfix: () => this.handleConsoleMerge()
    });

    this.callModal = new CallModalController({
      onAccept: () => this.handleCallAccepted(),
      onDecline: () => this.handleCallDeclined()
    });

    this.initAgentMesh();
    this.initUiEvents();
    this.loadScenario(this.currentScenarioKey);
    this.detectServerKey();
  }

  /**
   * Prefers a server-held key over one typed into the page.
   *
   * CALL-E documents its SDK as server-only and advises against putting keys in
   * browser code. When the dev server has CALLE_API_KEY set, the page routes
   * through it and never handles a credential at all.
   */
  async detectServerKey() {
    let live = false;
    try {
      const res = await fetch('/api/calle/mode', { headers: { accept: 'application/json' } });
      if (res.ok) {
        const mode = await res.json();
        this.serverMode = mode;
        if (mode?.serverKey) {
          calleService.enableProxyMode(mode.baseUrl || '/api/calle');
          live = true;
        }
        // Asking CALL-E to deliver terminal state to a receiver that exists is
        // what lets an escalation outlive the tab. With none configured the
        // ladder polls, which is correct rather than degraded: it just stops
        // when the page does, and the interface says so.
        this.webhookReady = calleService.setWebhookUrl(mode?.webhookUrl);
        this.seedRota(mode?.rota);
      }
    } catch (err) {
      // No proxy reachable, which is the same outcome as no key: simulation.
    }

    this.applyModeUi(live);
    if (live) await this.resumeInFlightCall();
  }

  /** States plainly whether a real phone can ring, and how to change that. */
  applyModeUi(live) {
    const banner = document.getElementById('modeBanner');
    const bannerText = document.getElementById('modeBannerText');
    if (banner && bannerText) {
      banner.dataset.mode = live ? 'live' : 'simulation';
      // A hosted copy will only ring numbers its owner nominated, and a reviewer
      // who types their own number deserves to know that before they press the
      // button rather than from a refusal afterwards.
      const restricted = live && this.serverMode?.dialling?.restricted;
      bannerText.textContent = live
        ? restricted
          ? 'Live mode on a hosted demo. It rings only the numbers its owner nominated, so it cannot be used to call anyone else. Simulation runs the whole ladder for any number.'
          : 'Live mode. The server holds a CALL-E key, so paging the rota will ring a real phone and spend credits.'
        : 'Simulation mode. No phone will ring and no credits are spent.';
    }

    const warning = document.getElementById('keyModeWarning');
    if (warning) {
      warning.dataset.mode = live ? 'server' : 'simulation';
      warning.innerHTML = live
        ? '<strong>Key held on the server.</strong> Calls route through <code>/api/calle</code>, which attaches the credential on the way out. Nothing sensitive reaches this page, which is the arrangement CALL-E\'s server-only guidance asks for.'
        : '<strong>Simulation mode.</strong> No CALL-E key is loaded on the server, so no phone will ring. Put your key in a <code>.env</code> file at the project root as <code>CALLE_API_KEY=iams_live_...</code> and restart the dev server. There is deliberately no key field on this page.';
    }

    if (this.dispatchRealCallBtn) {
      this.dispatchRealCallBtn.querySelector('span').textContent = live ? '📞 Page the rota' : '🧪 Run simulated page';
    }
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  cacheDom() {
    const $ = (id) => document.getElementById(id);

    this.scenarioSelectEl = $('scenarioSelect');
    this.triggerCallBtn = $('triggerCallBtn');
    this.realCallModalBtn = $('realCallModalBtn');
    this.audioToggleBtn = $('audioToggleBtn');
    this.audioIconEl = $('audioIcon');
    this.audioStatusTextEl = $('audioStatusText');
    this.callStatusBadgeEl = $('callStatusBadge');
    this.orbCallDurationEl = $('orbCallDuration');
    this.orbSpeakerLabelEl = $('orbSpeakerLabel');
    this.transcriptContentEl = $('transcriptContent');
    this.eventsContentEl = $('eventsContent');
    this.voiceRecogBadgeEl = $('voiceRecogBadge');
    this.micToggleBtn = $('micToggleBtn');
    this.voiceTextInput = $('voiceTextInput');
    this.voiceSendBtn = $('voiceSendBtn');
    this.incidentLevelEl = $('incidentLevel');
    this.affectedServiceEl = $('affectedService');
    this.errorCodeEl = $('errorCode');
    this.openPrBtn = $('openPrBtn');
    this.exportRcaBtn = $('exportRcaBtn');
    this.resetDemoBtn = $('resetDemoBtn');

    this.realPhoneCallModal = $('realPhoneCallModal');
    this.closeRealCallModalBtn = $('closeRealCallModalBtn');
    this.cancelRealCallBtn = $('cancelRealCallBtn');
    this.dispatchRealCallBtn = $('dispatchRealCallBtn');
    this.realCallStatusBox = $('realCallStatusBox');
    this.realCallBadge = $('realCallBadge');
    this.realCallId = $('realCallId');
    this.realCallActivity = $('realCallActivity');
    this.realPhoneValidationNotice = $('realPhoneValidationNotice');
    this.switchBrowserSimBtn = $('switchBrowserSimBtn');

    this.rotaListEl = $('rotaList');
    this.rotaRows = this.rotaListEl ? Array.from(this.rotaListEl.querySelectorAll('.rota-row')) : [];
    this.countryPillBtns = document.querySelectorAll('.country-pill-btn');
    this.transcriptTabs = document.querySelectorAll('.transcript-tab');

    this.decisionCard = $('decisionCard');
    this.decisionIcon = $('decisionIcon');
    this.decisionTitle = $('decisionTitle');
    this.decisionAction = $('decisionAction');
    this.decisionBy = $('decisionBy');
    this.decisionConfidence = $('decisionConfidence');
    this.decisionReached = $('decisionReached');
    this.decisionReason = $('decisionReason');
    this.decisionRawJson = $('decisionRawJson');
    this.decisionCompleted = $('decisionCompleted');
    this.decisionCallId = $('decisionCallId');
    this.decisionEvidence = $('decisionEvidence');
    this.decisionEvidenceWrap = $('decisionEvidenceWrap');
    this.decisionTranscript = $('decisionTranscript');
    this.decisionElapsed = $('decisionElapsed');

    this.callbackPanel = $('callbackPanel');
    this.callbackTitle = $('callbackTitle');
    this.callbackDetail = $('callbackDetail');
    this.callbackCountdown = $('callbackCountdown');
    this.callBackNowBtn = $('callBackNowBtn');

    // Per-call transcript rendering state, reset whenever a new rung starts.
    this.transcriptCallId = null;
    this.renderedTurnCount = 0;
  }

  /** Restores the rota and API key the operator entered on a previous visit. */
  restoreOperatorSettings() {
    try {
      const savedRota = JSON.parse(localStorage.getItem(ROTA_STORAGE_KEY) || 'null');
      if (savedRota && Array.isArray(savedRota)) {
        savedRota.forEach((contact) => {
          const row = this.rotaRows.find((r) => r.dataset.contact === contact.id);
          if (!row) return;
          const nameInput = row.querySelector('[data-field="name"]');
          const phoneInput = row.querySelector('[data-field="phone"]');
          if (nameInput && contact.name) nameInput.value = contact.name;
          if (phoneInput && contact.phone) phoneInput.value = contact.phone;
        });
      }
    } catch (err) {
      console.warn('Could not restore saved rota:', err);
    }
  }

  /**
   * Prefills the rota from the rota the server was configured with.
   *
   * The server reads it from the environment rather than from source, so a
   * checkout of this repository contains nobody's phone number and a fresh
   * clone opens onto empty fields. Anything the operator has already typed in
   * this browser wins, because their own edit is the more recent intent and
   * silently replacing a number that is about to be dialled would be worse
   * than showing none at all.
   *
   * @param {Array<{id: string, name: string, phone: string}>} [seed]
   */
  seedRota(seed) {
    if (!Array.isArray(seed) || !seed.length) return;

    let filled = false;
    for (const contact of seed) {
      const row = this.rotaRows.find((r) => r.dataset.contact === contact?.id);
      if (!row) continue;

      const nameInput = row.querySelector('[data-field="name"]');
      const phoneInput = row.querySelector('[data-field="phone"]');
      if (nameInput && contact.name && !nameInput.value.trim()) {
        nameInput.value = contact.name;
        filled = true;
      }
      if (phoneInput && contact.phone && !phoneInput.value.trim()) {
        phoneInput.value = contact.phone;
        filled = true;
      }
    }

    // The preview is built from the rota fields, so it has to be rebuilt after
    // they change. Nothing is dialled here; this only updates what is on screen.
    if (filled) this.refreshCallPreview();
  }

  /**
   * Records an in-flight call so a page reload does not lose track of it.
   *
   * Without this, closing the tab during a live call leaves an incident whose
   * outcome can only be recovered by placing a second call, which would dial a
   * sleeping engineer twice.
   */
  rememberInFlightCall(event) {
    try {
      localStorage.setItem(IN_FLIGHT_STORAGE_KEY, JSON.stringify({
        incidentId: this.incidentId,
        callId: event.callId,
        idempotencyKey: event.idempotencyKey,
        contactId: event.contact?.id,
        contactName: event.contact?.displayName || event.contact?.name,
        placedAt: new Date().toISOString()
      }));
    } catch (err) {
      console.warn('Could not record in-flight call:', err);
    }
  }

  clearInFlightCall() {
    try { localStorage.removeItem(IN_FLIGHT_STORAGE_KEY); } catch (err) { /* storage optional */ }
  }

  /**
   * Offers to resume a call that was still live when the page was last closed.
   * Reads the existing call by id rather than creating a replacement.
   */
  async resumeInFlightCall() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(IN_FLIGHT_STORAGE_KEY) || 'null');
    } catch (err) {
      return;
    }
    if (!saved?.callId || !calleService.isLiveMode) return;

    // What the server recorded while nobody was watching. The browser missed
    // any rung that finished after the tab closed, and those outcomes are the
    // ones a returning operator most needs, because they are the ones they
    // cannot reconstruct by looking at the screen.
    await this.recoverIncidentFromServer(saved.incidentId);

    const snapshot = await calleService.pollCall(saved.callId, { name: saved.contactName });
    if (!snapshot || snapshot.error) return;

    this.realPhoneCallModal?.classList.remove('hidden');
    this.realCallStatusBox?.classList.add('visible');
    if (this.realCallId) this.realCallId.textContent = `Recovered call task ${saved.callId}`;
    if (this.realCallActivity) {
      this.realCallActivity.textContent = snapshot.isTerminal
        ? `A call to ${saved.contactName} from a previous session has finished. Its result is shown below.`
        : `A call to ${saved.contactName} from a previous session is still ${snapshot.status}.`;
    }
    this.setLadderBadge(snapshot.isTerminal ? 'RECOVERED' : 'STILL RUNNING', 'amber');
    this.terminal.log(`[RECOVERY] Read existing call ${saved.callId} instead of placing a new one.`, 'amber');
    this.renderLiveTranscript(snapshot.callId, snapshot.transcript);

    if (snapshot.isTerminal) {
      const outcome = calleService.interpretDecision(snapshot);
      this.renderDecision({
        authorised: outcome.authorised,
        decision: outcome.decision,
        reason: outcome.reason,
        decidedBy: { name: saved.contactName },
        confidence: outcome.confidence,
        rungs: [{ contact: { name: saved.contactName }, callId: saved.callId, outcome, snapshot }]
      }, true);
      this.clearInFlightCall();
    }
  }

  /**
   * Reads back the call outcomes the server recorded for an incident.
   *
   * These arrive from the webhook receiver, which never trusts a delivery body:
   * every field it stored was re-read from the CALL-E API with the server key.
   * So this is a replay of verified history, not a second opinion, and it is
   * the only way the page learns about a rung that finished while the tab was
   * closed.
   */
  async recoverIncidentFromServer(incidentId) {
    if (!incidentId) return null;

    let record;
    try {
      const res = await fetch(`/api/calle/incident/${encodeURIComponent(incidentId)}`, {
        headers: { accept: 'application/json' }
      });
      if (!res.ok) return null;
      record = await res.json();
    } catch (err) {
      // No receiver deployed, or it is unreachable. Polling still covers the
      // case where somebody is watching, which is the case we are in.
      return null;
    }

    if (!record?.found || !record.calls?.length) return null;

    this.terminal.log(`[RECOVERY] The server recorded ${record.calls.length} completed call(s) for ${incidentId} while this page was closed.`, 'amber');
    if (!record.persistent) {
      this.terminal.log('[RECOVERY] That record lives in memory on the server and is lost when the instance recycles.', 'dim');
    }

    record.calls.forEach((call) => {
      const answerer = CalleIncidentCommander.describeAnswerer(call.answeredBy);
      const decision = CalleIncidentCommander.describeDecision(call.decision);
      this.terminal.log(
        `[RECOVERY] Call ${call.callId} to ${call.contactRole || 'the rota'}: answered by ${answerer}, ${decision}.`,
        call.authorised ? 'green' : 'amber'
      );
    });

    return record;
  }

  newIncidentId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return `inc-${stamp}-${Math.random().toString(36).slice(2, 7)}`;
  }

  initAgentMesh() {
    this.agentMesh = new AgentMesh({
      onStepChange: (step) => this.warRoom.setStep(step),
      onAgentMessage: (msg) => this.warRoom.appendMessage(msg.sender, msg.text, msg.agentKey, msg.time),
      onAgentThought: (agentKey, thought) => this.warRoom.updateThought(agentKey, thought),
      onConfidenceUpdate: (agentKey, percent) => this.warRoom.updateConfidence(agentKey, percent),
      onTerminalLog: (line, type) => this.terminal.log(line, type),
      onCodeReady: (scenario) => this.codeViewer.setScenario(scenario),
      onCallStatusChange: (status) => this.updateCallStatus(status),
      onAuthorisationRequired: () => this.handleAuthorisationRequired()
    });
  }

  // ---------------------------------------------------------------------------
  // Rota handling
  // ---------------------------------------------------------------------------

  /** Reads the escalation ladder out of the DOM in rung order. */
  readRota() {
    return this.rotaRows.map((row) => {
      const id = row.dataset.contact;
      const role = id === 'primary' ? 'primary on-call engineer'
        : id === 'backup' ? 'backup on-call engineer'
          : 'engineering manager and incident owner';
      // name may be blank. The call prompt handles that by asking for the role
      // instead of inventing a name, so the UI needs its own always-present label.
      const name = (row.querySelector('[data-field="name"]')?.value || '').trim();
      return {
      id,
      name,
      displayName: name || role.replace(/^./, (ch) => ch.toUpperCase()),
      role,
      phone: (row.querySelector('[data-field="phone"]')?.value || '').trim()
      // region and locale are filled in from resolved coverage before dialling.
      };
    });
  }

  /**
   * Renders the exact call task and result schema that rung 1 would send.
   *
   * The prompt is what the person on the phone actually hears, and it changes
   * with the rota entry, so it is worth being able to read it before a credit
   * is committed rather than after.
   */
  refreshCallPreview() {
    const taskEl = document.getElementById('callPreviewTask');
    const schemaEl = document.getElementById('callPreviewSchema');
    if (!taskEl || !schemaEl) return;

    schemaEl.textContent = JSON.stringify(INCIDENT_DECISION_SCHEMA, null, 2);

    const primary = this.readRota()[0];
    if (!primary?.phone) {
      taskEl.textContent = 'Enter a phone number for rung 1 to preview the call script.';
      return;
    }

    const check = calleService.validatePhoneNumber(primary.phone);
    if (!check.valid) {
      taskEl.textContent = check.error;
      return;
    }

    const named = isPersonName(primary.name);
    const header = named
      ? `Dialling ${check.phone} (${check.region.name}, ${check.region.locale}). CALL-E will confirm it is speaking to ${primary.name}.`
      : `Dialling ${check.phone} (${check.region.name}, ${check.region.locale}). No person name given, so CALL-E will ask for the ${primary.role} by role. Adding a real name makes the identity check, and therefore the authorisation, more reliable.`;

    taskEl.textContent = `${header}\n\n${calleService.buildTaskPrompt(this.currentScenario, primary)}`;
  }

  persistRota(rota) {
    try {
      localStorage.setItem(ROTA_STORAGE_KEY, JSON.stringify(rota.map((c) => ({ id: c.id, name: c.name, phone: c.phone }))));
    } catch (err) {
      console.warn('Could not persist rota:', err);
    }
  }

  setRungState(contactId, state, label) {
    const row = this.rotaRows.find((r) => r.dataset.contact === contactId);
    if (!row) return;
    const stateEl = row.querySelector('.rota-state');
    if (!stateEl) return;
    stateEl.dataset.state = state;
    stateEl.textContent = label;
  }

  resetRungStates() {
    this.rotaRows.forEach((row) => {
      const stateEl = row.querySelector('.rota-state');
      if (stateEl) {
        stateEl.dataset.state = 'idle';
        stateEl.textContent = 'idle';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // UI wiring
  // ---------------------------------------------------------------------------

  initUiEvents() {
    if (this.scenarioSelectEl) {
      this.scenarioSelectEl.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom-incident') {
          this.reportModal.showCustom();
        } else {
          this.loadScenario(val);
        }
      });
    }

    if (this.triggerCallBtn) {
      this.triggerCallBtn.addEventListener('click', () => {
        this.callModal.triggerIncomingCall(this.currentScenario);
        this.orb.setState('calling');
        this.updateCallStatus('CALLING...');
      });
    }

    if (this.realCallModalBtn) {
      this.realCallModalBtn.addEventListener('click', () => {
        this.realPhoneCallModal?.classList.remove('hidden');
      });
    }

    const closeRotaModal = () => this.realPhoneCallModal?.classList.add('hidden');
    this.closeRealCallModalBtn?.addEventListener('click', closeRotaModal);
    this.cancelRealCallBtn?.addEventListener('click', closeRotaModal);

    this.countryPillBtns?.forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-code');
        const primaryPhone = this.rotaRows[0]?.querySelector('[data-field="phone"]');
        if (!primaryPhone) return;
        primaryPhone.value = code + (primaryPhone.value || '').replace(/^\+\d{1,4}/, '');
        primaryPhone.focus();
      });
    });

    this.switchBrowserSimBtn?.addEventListener('click', () => {
      closeRotaModal();
      this.handleCallAccepted();
    });

    // The engineer came back before their own deadline. Ringing them now is
    // what they asked for, and it is recorded as an operator ending the wait
    // rather than as the agreed time having passed.
    this.callBackNowBtn?.addEventListener('click', () => {
      if (this.ladder?.callBackNow()) {
        this.callbackCountdown.textContent = '00:00';
        this.terminal.log('[ESCALATION] Callback wait ended early by the operator.', 'cyan');
      }
    });

    this.dispatchRealCallBtn?.addEventListener('click', () => this.pageTheRota());

    // Keep the call-script preview in step with the rota, so nobody spends a
    // credit on a prompt they have not read.
    this.rotaRows.forEach((row) => {
      row.querySelectorAll('input').forEach((input) => {
        input.addEventListener('input', () => this.refreshCallPreview());
      });
    });
    this.realCallModalBtn?.addEventListener('click', () => this.refreshCallPreview());
    this.refreshCallPreview();

    this.transcriptTabs?.forEach((tab) => {
      tab.addEventListener('click', () => {
        this.transcriptTabs.forEach((t) => t.classList.toggle('active', t === tab));
        const showEvents = tab.dataset.stream === 'events';
        this.transcriptContentEl?.classList.toggle('hidden', showEvents);
        this.eventsContentEl?.classList.toggle('hidden', !showEvents);
      });
    });

    if (this.audioToggleBtn) {
      this.audioToggleBtn.addEventListener('click', () => {
        const isEnabled = soundEngine.toggleAudio();
        this.audioIconEl.textContent = isEnabled ? '🔊' : '🔇';
        this.audioStatusTextEl.textContent = isEnabled ? 'Audio ON' : 'Audio OFF';
      });
    }

    if (this.micToggleBtn) {
      this.micToggleBtn.addEventListener('click', () => {
        const result = speechEngine.toggleListening();
        this.micToggleBtn.classList.toggle('recording', result.isListening);
        this.voiceRecogBadgeEl?.classList.toggle('hidden', !result.isListening);
      });

      speechEngine.onUserTranscript = (text) => {
        this.micToggleBtn.classList.remove('recording');
        this.voiceRecogBadgeEl?.classList.add('hidden');
        this.appendTranscript('You', text, 'user');
        this.agentMesh.handleUserQuery(text);
      };
    }

    if (this.voiceSendBtn && this.voiceTextInput) {
      const sendInput = () => {
        const val = this.voiceTextInput.value.trim();
        if (!val) return;
        this.appendTranscript('You', val, 'user');
        this.agentMesh.handleUserQuery(val);
        this.voiceTextInput.value = '';
      };
      this.voiceSendBtn.addEventListener('click', sendInput);
      this.voiceTextInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendInput();
      });
    }

    speechEngine.onSpeechStart = (text) => {
      this.orb.setState('speaking');
      if (this.orbSpeakerLabelEl) this.orbSpeakerLabelEl.textContent = 'CALL-E (Speaking)';
      this.appendTranscript('CALL-E', text, 'calle');
    };

    speechEngine.onSpeechEnd = () => {
      this.orb.setState('connected');
      if (this.orbSpeakerLabelEl) this.orbSpeakerLabelEl.textContent = 'CALL-E (Connected)';
    };

    this.openPrBtn?.addEventListener('click', () => this.reportModal.showPullRequest(this.currentScenario));
    this.exportRcaBtn?.addEventListener('click', () => {
      const outcome = this.agentMesh.lastOutcome;
      const audit = outcome
        ? buildAuditRecord({
            scenario: this.currentScenario,
            outcome,
            incidentId: this.incidentId,
            isLive: calleService.isLiveMode,
            connectionMode: calleService.connectionMode
          })
        : null;
      this.reportModal.showRcaReport(this.currentScenario, outcome, audit);
    });
    this.resetDemoBtn?.addEventListener('click', () => this.reset());
  }

  // ---------------------------------------------------------------------------
  // Paging the rota
  // ---------------------------------------------------------------------------

  /**
   * Runs the escalation ladder for the current incident.
   *
   * Everything the user sees about call state comes from CALL-E's own API, and
   * simulated runs are labelled as simulated rather than dressed up as real.
   */
  async pageTheRota() {
    this.clearValidationNotice();
    this.resetRungStates();
    this.hideDecisionCard();
    this.hideCallbackPanel();

    const rota = this.readRota();
    const armed = rota.filter((c) => c.phone);

    if (armed.length === 0) {
      this.showValidationNotice('Enter at least one phone number in international format, for example +14155552671.');
      return;
    }

    const coverageNotes = [];
    for (const contact of armed) {
      const check = calleService.validatePhoneNumber(contact.phone);
      if (!check.valid) {
        this.showValidationNotice(`${contact.displayName}: ${check.error}`);
        return;
      }
      contact.phone = check.phone;
      // Routing hints resolved from published coverage, not left for CALL-E to guess.
      contact.region = check.region?.code;
      contact.locale = check.region?.locale;
      if (check.warning) coverageNotes.push(`${contact.displayName} (${check.region.name}): ${check.warning}`);
    }

    this.persistRota(rota);

    // Whether a real phone can ring is decided entirely by the server key.
    const isLive = calleService.isLiveMode;
    this.incidentId = this.newIncidentId();

    if (this.realCallStatusBox) this.realCallStatusBox.classList.add('visible');
    this.setLadderBadge(isLive ? 'PAGING RUNG 1' : 'SIMULATION (NO CREDITS SPENT)', isLive ? 'amber' : 'cyan');
    if (this.realCallId) this.realCallId.textContent = `Incident ${this.incidentId}`;
    if (this.realCallActivity) {
      this.realCallActivity.textContent = isLive
        ? `Dialling ${armed.length} rung${armed.length > 1 ? 's' : ''} in order until someone authorises an action.`
        : 'No server key loaded. Running a labelled simulation of the escalation ladder. No phone will ring.';
    }
    if (this.dispatchRealCallBtn) this.dispatchRealCallBtn.disabled = true;

    this.terminal.log(`>>> [ESCALATION] Paging on-call rota for ${this.incidentId} (${isLive ? calleService.connectionMode.toUpperCase() : 'SIMULATED'})`, 'cyan');
    armed.forEach((c) => this.terminal.log(`[ROUTING] ${c.name} -> ${c.phone} region ${c.region} locale ${c.locale}`, 'dim'));
    coverageNotes.forEach((note) => this.terminal.log(`[COVERAGE] ${note}`, 'amber'));

    this.ladder = new EscalationLadder({
      service: calleService,
      onEvent: (event) => this.handleLadderEvent(event)
    });

    let outcome;
    try {
      outcome = await this.ladder.run({ scenario: this.currentScenario, contacts: rota, incidentId: this.incidentId });
    } catch (err) {
      this.setLadderBadge('LADDER FAILED', 'pink');
      if (this.realCallActivity) this.realCallActivity.textContent = err?.message || 'The escalation ladder stopped unexpectedly.';
      this.terminal.log(`[ESCALATION] Ladder failed: ${err?.message || err}`, 'red');
      return;
    } finally {
      if (this.dispatchRealCallBtn) this.dispatchRealCallBtn.disabled = false;
      this.stopEventPolling();
    }

    this.clearInFlightCall();
    this.renderDecision(outcome, isLive);
    await this.agentMesh.applyLadderOutcome(outcome);
  }

  /** Translates ladder events into rung badges, terminal lines, and event polling. */
  handleLadderEvent(event) {
    const contactId = event.contact?.id;

    switch (event.type) {
      case 'ladder:start':
        this.terminal.log(`[ESCALATION] Ladder armed with ${event.rotaSize} rung(s).`, 'dim');
        break;

      case 'rung:dialing':
        this.setRungState(contactId, 'dialing', 'dialling');
        this.setLadderBadge(`DIALLING ${(event.contact.displayName || event.contact.name).toUpperCase()}`, 'amber');
        this.terminal.log(`[ESCALATION] Rung ${event.index + 1}: dialling ${event.contact.displayName || event.contact.name}${event.escalatedFrom ? ` after ${event.escalatedFrom} did not decide` : ''}.`, 'cyan');
        break;

      case 'rung:placed':
        this.setRungState(contactId, 'ringing', 'ringing');
        if (this.realCallId) this.realCallId.textContent = `Call task ${event.callId}`;
        this.terminal.log(`[CALL-E] Call task ${event.callId} created (idempotency ${event.idempotencyKey}).`, 'dim');
        // Saved the moment the id arrives. The platform's recovery guidance is
        // to read an existing call by id after a restart rather than create
        // another one to learn its outcome.
        this.rememberInFlightCall(event);
        this.startEventPolling(event.callId);
        break;

      case 'rung:progress': {
        const s = event.snapshot;
        if (s.error) {
          // A transient read failure is not a call state. Say so rather than
          // rendering it as if the call had changed.
          if (this.realCallActivity) this.realCallActivity.textContent = `Could not read call state: ${s.error}`;
          break;
        }
        // `in_progress` means the attempt is under way, which includes ringing.
        // Only a turn spoken by the recipient establishes that anybody picked
        // up, so that is what the connected state and the green badge wait for.
        const speaking = hasRecipientTurn(s.transcript);
        const who = event.contact.displayName || event.contact.name;

        this.setRungState(
          contactId,
          speaking ? 'connected' : 'ringing',
          speaking ? 'on the line' : s.attemptStatus === 'in_progress' ? 'ringing' : s.attemptStatus
        );
        if (this.realCallActivity) {
          this.realCallActivity.textContent = `${who}: call ${s.status}, attempt ${s.attemptStatus}.`;
        }
        if (speaking) {
          this.setLadderBadge(`${who.toUpperCase()} ON THE LINE`, 'green');
        } else if (s.attemptStatus === 'in_progress') {
          this.setLadderBadge(`RINGING ${who.toUpperCase()}`, 'amber');
        }
        this.bindHudToLiveCall(event.contact, s);
        this.renderLiveTranscript(s.callId, s.transcript);
        break;
      }

      case 'rung:completed': {
        const reached = event.outcome.reachedEngineer;
        const answerer = CalleIncidentCommander.describeAnswerer(event.outcome.answeredBy);
        this.setRungState(contactId, reached ? 'answered' : 'noanswer', reached ? 'answered' : 'no answer');
        this.terminal.log(`[CALL-E] Rung ${event.index + 1} answered by ${answerer}: ${CalleIncidentCommander.describeDecision(event.outcome.decision)}.`, reached ? 'green' : 'amber');
        if (event.snapshot) {
          this.bindHudToLiveCall(event.contact, event.snapshot);
          this.renderLiveTranscript(event.snapshot.callId, event.snapshot.transcript);
        }
        this.stopEventPolling();
        break;
      }

      case 'rung:simulated':
        this.setRungState(contactId, event.outcome.reachedEngineer ? 'answered' : 'noanswer', event.outcome.reachedEngineer ? 'answered (sim)' : 'no answer (sim)');
        this.terminal.log(`[SIMULATED] Rung ${event.index + 1}: ${event.outcome.reason}`, 'dim');
        break;

      case 'rung:failed':
        this.setRungState(contactId, 'failed', 'failed');
        this.terminal.log(`[CALL-E] Rung ${event.index + 1} could not be placed: ${event.error}`, 'red');
        if (this.realCallActivity) this.realCallActivity.textContent = event.error;
        break;

      case 'rung:timeout':
        this.setRungState(contactId, 'noanswer', 'timed out');
        this.terminal.log(`[ESCALATION] Rung ${event.index + 1} timed out waiting for a terminal call state.`, 'amber');
        break;

      case 'rung:unreadable':
        this.setRungState(contactId, 'failed', 'unreadable');
        this.setLadderBadge('CANNOT READ CALL STATE', 'pink');
        this.terminal.log(`[CALL-E] Lost contact with the API while rung ${event.index + 1} was live: ${event.error}`, 'red');
        if (this.realCallActivity) {
          this.realCallActivity.textContent = `The call may still be in progress, but its state cannot be read. ${event.error}`;
        }
        break;

      case 'rung:callback-scheduled': {
        const who = event.contact.displayName || event.contact.name;
        this.setRungState(contactId, 'callback', `callback in ${event.minutes}m`);
        this.setLadderBadge(`CALLBACK AGREED WITH ${who.toUpperCase()}`, 'amber');
        this.showCallbackPanel(event);
        this.terminal.log(
          `[ESCALATION] ${who} asked for ${event.requestedMinutes} minute(s) before deciding.${event.capped ? ` Capped to ${event.minutes}, the longest this ladder waits.` : ''} The backup is NOT being woken.`,
          'amber'
        );
        if (event.simulatedWait) {
          this.terminal.log('[SIMULATED] The wait is compressed for the demo. Nothing is dialled either way.', 'dim');
        }
        break;
      }

      case 'rung:callback-dialing': {
        const who = event.contact.displayName || event.contact.name;
        this.hideCallbackPanel();
        this.terminal.log(
          `[ESCALATION] Calling ${who} back as agreed${event.endedBy === 'skipped' ? ', early, at the operator\'s request' : ` after ${event.minutes} minute(s)`}.`,
          'cyan'
        );
        break;
      }

      case 'rung:callback-refused': {
        const who = event.contact.displayName || event.contact.name;
        this.hideCallbackPanel();
        this.terminal.log(
          `[ESCALATION] ${who} asked for a second callback. They have already had one on this incident, so the ladder is climbing instead.`,
          'amber'
        );
        break;
      }

      case 'rung:escalating':
        this.hideCallbackPanel();
        if (event.hasNext) {
          this.terminal.log(`[ESCALATION] Climbing to the next rung. Reason: ${event.reason}`, 'amber');
        }
        break;

      case 'ladder:resolved': {
        const sim = !calleService.isLiveMode;
        const label = event.authorised ? 'AUTHORISED' : 'DECIDED — HELD';
        this.setLadderBadge(sim ? `SIMULATED — ${label}` : label, sim ? 'cyan' : event.authorised ? 'green' : 'amber');
        this.hideCallbackPanel();
        break;
      }

      case 'ladder:exhausted':
        this.setLadderBadge(calleService.isLiveMode ? 'NO AUTHORISATION' : 'SIMULATED — NO AUTHORISATION', calleService.isLiveMode ? 'pink' : 'cyan');
        this.hideCallbackPanel();
        break;

      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Developer event stream
  // ---------------------------------------------------------------------------

  /** Streams CALL-E developer events into the events tab while a call is live. */
  startEventPolling(callId) {
    this.stopEventPolling();
    if (!calleService.isLiveMode) return;

    let cursor;
    this.eventPollTimer = setInterval(async () => {
      const { events, nextCursor } = await calleService.listCallEvents(callId, cursor);
      if (nextCursor) cursor = nextCursor;
      events.forEach((evt) => this.appendCallEvent(evt));
    }, 3000);
  }

  stopEventPolling() {
    if (this.eventPollTimer) {
      clearInterval(this.eventPollTimer);
      this.eventPollTimer = null;
    }
  }

  appendCallEvent(evt) {
    if (!this.eventsContentEl || !evt?.id || this.seenEventIds.has(evt.id)) return;
    this.seenEventIds.add(evt.id);

    this.eventsContentEl.querySelector('.transcript-placeholder')?.remove();

    const row = document.createElement('div');
    row.className = 'event-entry';
    row.dataset.level = evt.level || 'info';
    const time = evt.created_at ? new Date(evt.created_at).toTimeString().slice(0, 8) : '';
    row.innerHTML = `<span class="event-time">${escapeHtml(time)}</span>`
      + `<span class="event-body">`
      + `<span class="event-type">${escapeHtml(evt.type || 'event')}</span>`
      + (evt.message ? `<span class="event-message">${escapeHtml(evt.message)}</span>` : '')
      + `</span>`;
    this.eventsContentEl.appendChild(row);
    this.eventsContentEl.scrollTop = this.eventsContentEl.scrollHeight;
  }

  /**
   * Mirrors the real call transcript into the transcript pane as it arrives.
   *
   * The rendered count is tracked per call. Each rung is a separate call whose
   * turns start again at zero, so a single shared counter would suppress the
   * backup's entire conversation whenever the primary's was longer.
   */
  renderLiveTranscript(callId, turns) {
    if (!turns || turns.length === 0 || !this.transcriptContentEl) return;

    if (this.transcriptCallId !== callId) {
      this.transcriptCallId = callId;
      this.renderedTurnCount = 0;
    }
    if (turns.length <= this.renderedTurnCount) return;

    this.transcriptContentEl.querySelector('.transcript-placeholder')?.remove();
    turns.slice(this.renderedTurnCount).forEach((turn) => {
      this.appendTranscript(turn.speaker, turn.text, turn.speaker === 'CALL-E' ? 'calle' : 'user');
    });
    this.renderedTurnCount = turns.length;
  }

  /**
   * Drives the voice HUD from the real call's lifecycle.
   *
   * Without this the orb, the timer, and the status badge sit at standby while
   * an actual phone is ringing, which makes the live path look less real than
   * the browser simulation. Every value here comes from `calls.get`.
   */
  bindHudToLiveCall(contact, snapshot) {
    const attempt = snapshot.attemptStatus;

    if (attempt === 'queued' || attempt === 'dialing') {
      this.orb.setState('calling');
      this.updateCallStatus('CALLING...');
      if (this.orbSpeakerLabelEl) {
        this.orbSpeakerLabelEl.textContent = `Dialling ${contact.displayName || contact.name}`;
      }
      this.stopCallTimer();
      return;
    }

    if (attempt === 'in_progress') {
      this.orb.setState('connected');
      this.updateCallStatus('CONNECTED');
      if (this.orbSpeakerLabelEl) {
        this.orbSpeakerLabelEl.textContent = `${contact.displayName || contact.name} on the line`;
      }
      if (!this.callTimerInterval) this.startCallTimer();
      return;
    }

    if (snapshot.isTerminal) {
      this.stopCallTimer();
      this.orb.setState('standby');
      if (this.orbSpeakerLabelEl) {
        this.orbSpeakerLabelEl.textContent = snapshot.failureCode
          ? `Call failed: ${snapshot.failureCode}`
          : `Call with ${contact.displayName || contact.name} ended`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Decision rendering
  // ---------------------------------------------------------------------------

  renderDecision(outcome, isLive) {
    if (!this.decisionCard) return;
    this.decisionCard.classList.remove('hidden');

    const authorised = outcome.authorised;
    const held = outcome.decision === 'hold_for_review';

    // A simulated run must never read like a real voice authorisation, so the
    // title says plainly which one the viewer is looking at.
    const prefix = isLive ? '' : 'Simulated: ';
    this.decisionIcon.textContent = isLive ? (authorised ? '✅' : held ? '✋' : '⛔') : '🧪';
    this.decisionTitle.textContent = authorised
      ? `${prefix}production change authorised by voice`
      : held
        ? `${prefix}hotfix held by the engineer`
        : `${prefix}no authorisation obtained`;
    this.decisionCard.dataset.state = !isLive ? 'simulated' : authorised ? 'authorised' : held ? 'held' : 'blocked';

    this.decisionAction.textContent = CalleIncidentCommander.describeDecision(outcome.decision);
    this.decisionBy.textContent = outcome.decidedBy?.displayName || outcome.decidedBy?.name || 'Nobody on the rota';

    const lastRung = outcome.rungs?.[outcome.rungs.length - 1];
    const conf = outcome.confidence ?? lastRung?.outcome?.confidence ?? null;
    this.decisionConfidence.textContent = conf === null
      ? (isLive ? 'not reported' : 'simulated')
      : `${(conf * 100).toFixed(0)}%${lastRung?.outcome?.confidenceLabel ? ` (${lastRung.outcome.confidenceLabel})` : ''}`;

    this.decisionReached.textContent = CalleIncidentCommander.describeAnswerer(lastRung?.outcome?.answeredBy);
    this.decisionReason.textContent = outcome.reason || '';

    const snapshot = lastRung?.snapshot;
    this.decisionCompleted.textContent = snapshot
      ? (snapshot.taskCompleted === true ? 'yes' : snapshot.taskCompleted === false ? 'no' : 'not reported')
      : 'simulated';
    this.decisionCallId.textContent = lastRung?.callId || (isLive ? 'none placed' : 'simulated');

    if (this.decisionElapsed) {
      // Counted from the page being raised, not from a call connecting, because
      // an unanswered rung is part of how long production ran undecided.
      this.decisionElapsed.textContent = typeof outcome.elapsedMs === 'number'
        ? describeDuration(outcome.elapsedMs)
        : 'not measured';
    }

    // Evidence is CALL-E's own justification for the outcome it reported, which
    // is exactly what a post-incident reviewer will want to check.
    const evidence = snapshot?.evidence || [];
    this.decisionEvidence.innerHTML = '';
    this.decisionEvidenceWrap.classList.toggle('hidden', evidence.length === 0);
    evidence.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      this.decisionEvidence.appendChild(li);
    });

    const turns = snapshot?.transcript || lastRung?.transcript || [];
    this.decisionTranscript.textContent = turns.length
      ? turns.map((t) => `${t.speaker}: ${t.text}`).join('\n')
      : 'No transcript returned for this call.';

    const raw = snapshot?.structuredResult ?? lastRung?.outcome ?? {};
    this.decisionRawJson.textContent = JSON.stringify(raw, null, 2);

    if (!isLive) {
      this.decisionReason.textContent = `${outcome.reason} This run was simulated and no phone was dialled.`;
    }
  }

  hideDecisionCard() {
    this.decisionCard?.classList.add('hidden');
  }

  /**
   * Shows the agreed callback, counting down.
   *
   * A ladder that has stopped climbing on purpose looks exactly like a ladder
   * that has hung, unless something on screen says which one it is. The panel
   * says who asked, how long for, and what is not happening in the meantime.
   */
  showCallbackPanel(event) {
    if (!this.callbackPanel) return;
    const who = event.contact.displayName || event.contact.name;

    this.callbackTitle.textContent = `${who} asked for ${event.requestedMinutes} minute(s)`;
    this.callbackDetail.textContent = [
      event.capped
        ? `Waiting ${event.minutes} minutes, the longest this ladder holds before climbing anyway.`
        : `Waiting ${event.minutes} minutes, then calling them back.`,
      'Nothing ships while this runs, and nobody else on the rota is being woken.',
      event.simulatedWait ? 'Simulated run, so the wait is compressed. No phone will ring.' : ''
    ].filter(Boolean).join(' ');

    this.callbackPanel.classList.remove('hidden');
    this.startCallbackCountdown(new Date(event.dueAt).getTime());
  }

  hideCallbackPanel() {
    this.stopCallbackCountdown();
    this.callbackPanel?.classList.add('hidden');
  }

  startCallbackCountdown(dueAt) {
    this.stopCallbackCountdown();
    const tick = () => {
      const remaining = Math.max(0, dueAt - Date.now());
      const totalSeconds = Math.round(remaining / 1000);
      const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
      const secs = String(totalSeconds % 60).padStart(2, '0');
      if (this.callbackCountdown) this.callbackCountdown.textContent = `${mins}:${secs}`;
      if (remaining <= 0) this.stopCallbackCountdown();
    };
    tick();
    this.callbackTimer = setInterval(tick, 1000);
  }

  stopCallbackCountdown() {
    if (this.callbackTimer) clearInterval(this.callbackTimer);
    this.callbackTimer = null;
  }

  setLadderBadge(text, tone) {
    if (!this.realCallBadge) return;
    this.realCallBadge.textContent = text;
    this.realCallBadge.dataset.tone = tone;
  }

  showValidationNotice(message) {
    if (!this.realPhoneValidationNotice) return;
    this.realPhoneValidationNotice.textContent = message;
    this.realPhoneValidationNotice.classList.add('visible');
  }

  clearValidationNotice() {
    if (!this.realPhoneValidationNotice) return;
    this.realPhoneValidationNotice.textContent = '';
    this.realPhoneValidationNotice.classList.remove('visible');
  }

  // ---------------------------------------------------------------------------
  // Incident lifecycle
  // ---------------------------------------------------------------------------

  loadScenario(key) {
    this.currentScenarioKey = key;
    const scenario = INCIDENT_SCENARIOS[key];
    if (!scenario) return;
    this.currentScenario = scenario;

    this.reset();

    if (this.incidentLevelEl) this.incidentLevelEl.textContent = scenario.severity;
    if (this.affectedServiceEl) this.affectedServiceEl.textContent = scenario.service;
    if (this.errorCodeEl) this.errorCodeEl.textContent = scenario.errorCode;

    this.codeViewer.setScenario(scenario);
    this.agentMesh.setScenario(scenario);
  }

  handleCallAccepted() {
    this.startCallTimer();
    this.orb.setState('connected');
    this.updateCallStatus('CONNECTED');
    if (this.transcriptContentEl) {
      this.transcriptContentEl.innerHTML = '';
    }
    this.transcriptCallId = null;
    this.renderedTurnCount = 0;
    this.agentMesh.startIncidentPipeline();
  }

  handleCallDeclined() {
    this.reset();
    this.terminal.log('Incoming incident call rejected by the on-call engineer.', 'dim');
  }

  /** Called when the council has staged a patch and is blocked on a human. */
  handleAuthorisationRequired() {
    this.updateCallStatus('AWAITING AUTH');
    if (!calleService.isLiveMode) return;
    this.terminal.log('>>> Page the on-call rota to obtain a spoken authorisation.', 'amber');
  }

  handleConsoleMerge() {
    this.agentMesh.applyLadderOutcome({
      authorised: true,
      decision: 'deploy_hotfix',
      reason: 'Merged from the web console by the signed-in engineer.',
      decidedBy: { name: 'Console operator' },
      confidence: null,
      channel: 'console'
    });
  }

  /**
   * Builds an incident from pasted code using a real scan of that code.
   *
   * Nothing here invents a patch. The scanner reports what it actually matched,
   * with line numbers and the matched text, and says so plainly when it matched
   * nothing. A confident wrong diff during an incident is worse than no diff.
   */
  handleCustomIncident(custom) {
    const scan = scanCode(custom.originalCode, custom.fileName);
    const top = primaryFinding(scan);
    const shortName = custom.fileName.split('/').pop();

    const customScenario = {
      id: 'custom-' + Date.now(),
      title: top ? `${top.title} in ${shortName}` : `Unclassified failure in ${shortName}`,
      category: 'CUSTOM INCIDENT',
      severity: top?.severity === 'critical' ? 'SEV-1 CRITICAL' : top ? 'SEV-2 HIGH' : 'SEV-3 UNCLASSIFIED',
      service: shortName,
      fileName: custom.fileName,
      errorCode: top ? top.cwe : 'Unclassified',
      impact: top
        ? `${top.title} reachable at line ${top.line} of ${custom.fileName}.`
        : `Reported failure in ${custom.fileName} that no scanner rule matched.`,
      callAlertText: top
        ? `Incident in ${shortName}. ${top.cwe} found at line ${top.line}.`
        : `Incident in ${shortName}. No known fault pattern matched, engineer judgement needed.`,
      stackTrace: custom.stackTrace,
      scan,
      rcaReport: {
        rootCause: describeScan(scan, custom.fileName),
        offendingCommit: 'not attributed for pasted code',
        vulnerabilityClass: top ? `${top.cwe}: ${top.title}` : 'Unclassified',
        timeToDetect: 'immediate on paste',
        recommendedFix: top
          ? top.recommendation
          : 'No automated recommendation. The scanner matched none of its rules, so this needs an engineer to read the code.'
      },
      originalCode: custom.originalCode,
      patchedCode: buildScanReport(scan, custom.fileName),
      diff: buildAnnotatedDiff(custom.originalCode, scan),
      testSuite: buildScanReport(scan, custom.fileName)
    };

    this.currentScenarioKey = 'custom-incident';
    this.currentScenario = customScenario;
    // Keep the incident feed label honest about which incident is loaded.
    if (this.scenarioSelectEl) this.scenarioSelectEl.value = 'custom-incident';
    this.reset();
    if (this.incidentLevelEl) this.incidentLevelEl.textContent = customScenario.severity;
    if (this.affectedServiceEl) this.affectedServiceEl.textContent = customScenario.service;
    if (this.errorCodeEl) this.errorCodeEl.textContent = customScenario.errorCode;
    this.codeViewer.setScenario(customScenario);
    this.agentMesh.setScenario(customScenario);
    this.callModal.triggerIncomingCall(customScenario);
  }

  appendTranscript(speaker, text, type) {
    if (!this.transcriptContentEl) return;
    this.transcriptContentEl.querySelector('.transcript-placeholder')?.remove();
    const entry = document.createElement('div');
    entry.className = `transcript-entry ${type}`;
    entry.innerHTML = `<span class="speaker-tag">${escapeHtml(speaker)}:</span><span>${escapeHtml(text)}</span>`;
    this.transcriptContentEl.appendChild(entry);
    this.transcriptContentEl.scrollTop = this.transcriptContentEl.scrollHeight;
  }

  updateCallStatus(status) {
    if (!this.callStatusBadgeEl) return;
    this.callStatusBadgeEl.textContent = status;
    this.callStatusBadgeEl.className = 'status-badge';
    if (status === 'STANDBY') this.callStatusBadgeEl.classList.add('status-standby');
    else if (status.includes('CALLING')) this.callStatusBadgeEl.classList.add('status-calling');
    else if (status === 'CONNECTED') this.callStatusBadgeEl.classList.add('status-connected');
    else if (status === 'AWAITING AUTH') this.callStatusBadgeEl.classList.add('status-gate');
  }

  startCallTimer() {
    this.stopCallTimer();
    this.callDurationSec = 0;
    this.callTimerInterval = setInterval(() => {
      this.callDurationSec++;
      const mins = String(Math.floor(this.callDurationSec / 60)).padStart(2, '0');
      const secs = String(this.callDurationSec % 60).padStart(2, '0');
      if (this.orbCallDurationEl) this.orbCallDurationEl.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  stopCallTimer() {
    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }
    if (this.orbCallDurationEl) this.orbCallDurationEl.textContent = '00:00';
  }

  reset() {
    this.stopCallTimer();
    this.stopEventPolling();
    this.ladder?.cancel();
    this.seenEventIds.clear();
    this.orb.setState('standby');
    this.updateCallStatus('STANDBY');
    this.warRoom.reset();
    this.terminal.clear();
    this.agentMesh.reset();
    this.resetRungStates();
    this.hideDecisionCard();
    if (this.orbSpeakerLabelEl) this.orbSpeakerLabelEl.textContent = 'CALL-E (Ready)';
    if (this.transcriptContentEl) {
      this.transcriptContentEl.innerHTML = '<p class="transcript-placeholder">Production systems operational. When an anomaly is detected, CALL-E will dial the on-call rota directly...</p>';
    }
    this.transcriptCallId = null;
    this.renderedTurnCount = 0;
    if (this.eventsContentEl) {
      this.eventsContentEl.innerHTML = '<p class="transcript-placeholder">Developer events from <code>calls.listEvents()</code> stream here once a real call task is running.</p>';
    }
  }
}

/**
 * Renders the scan as a plain text report.
 *
 * This fills the panes that would otherwise show a patched file and a generated
 * test suite. For pasted code neither of those exists, and showing a fabricated
 * one would misrepresent what the system actually did.
 */
/**
 * Renders a duration the way a person reading a post-mortem would say it.
 *
 * Seconds below a minute, because "0.7 minutes" is nobody's unit, and minutes
 * and seconds above it. Rounded, never padded with precision the measurement
 * does not have.
 */
function describeDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'not measured';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function buildScanReport(scan, fileName) {
  const header = [
    `Static scan of ${fileName}`,
    `${scan.scannedLines} lines, ${scan.rulesRun} rules applied.`,
    '',
    'This is a pattern scan of the pasted text. It is not a proof of correctness,',
    'and it does not generate a patch. Findings below are what actually matched.',
    ''
  ];

  if (scan.clean) {
    return [...header, 'No rule matched.', '', 'The reported failure is not one of the patterns this scanner knows.', 'An engineer needs to read the code directly.'].join('\n');
  }

  const body = scan.findings.flatMap((f, i) => [
    `${i + 1}. ${f.title}`,
    `   line        ${f.line}`,
    `   class       ${f.cwe}`,
    `   severity    ${f.severity}`,
    `   confidence  ${f.confidence}`,
    `   evidence    ${f.evidence}`,
    `   why         ${f.detail}`,
    `   fix         ${f.recommendation}`,
    ''
  ]);

  return [...header, `${scan.findings.length} finding${scan.findings.length === 1 ? '' : 's'}:`, '', ...body].join('\n');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

window.addEventListener('DOMContentLoaded', () => {
  window.callEApp = new CallEApp();
});
