/**
 * 4-Agent Autonomous Council Mesh
 * Coordinates the 4 agents in real-time:
 * Agent 1: CALL-E Operator (Voice & Dispatch)
 * Agent 2: Inspector Tracer (Root-Cause Detective)
 * Agent 3: Patch Architect (Vulcan Synthesizer)
 * Agent 4: Quality Guardian (Sentinel SRE & QA)
 */

import { soundEngine } from '../audio/soundEngine.js';
import { speechEngine } from '../audio/speechEngine.js';

export class AgentMesh {
  constructor(options = {}) {
    this.currentScenario = null;
    this.currentStep = 0; // 0=idle, 1=call/triage, 2=rca, 3=patch, 4=qa/deploy
    this.isCallActive = false;
    this.isProcessing = false;
    
    // Event callbacks
    this.onStepChange = options.onStepChange || null;
    this.onAgentMessage = options.onAgentMessage || null;
    this.onAgentThought = options.onAgentThought || null;
    this.onConfidenceUpdate = options.onConfidenceUpdate || null;
    this.onTerminalLog = options.onTerminalLog || null;
    this.onCodeReady = options.onCodeReady || null;
    this.onCallStatusChange = options.onCallStatusChange || null;
    this.onAuthorisationRequired = options.onAuthorisationRequired || null;

    // True once the council has staged a patch and is blocked on a human decision.
    this.awaitingAuthorisation = false;
    this.lastOutcome = null;
  }

  setScenario(scenario) {
    this.currentScenario = scenario;
    this.reset();
  }

  reset() {
    this.currentStep = 0;
    this.isCallActive = false;
    this.isProcessing = false;
    this.awaitingAuthorisation = false;
    this.lastOutcome = null;
    speechEngine.stop();
    soundEngine.stopRing();
    if (this.onCallStatusChange) this.onCallStatusChange('STANDBY');
  }

  emitMessage(sender, text, agentKey) {
    soundEngine.playAgentBeep(agentKey || 'operator');
    if (this.onAgentMessage) {
      this.onAgentMessage({
        sender,
        text,
        agentKey,
        time: new Date().toTimeString().split(' ')[0]
      });
    }
  }

  emitThought(agentKey, thought) {
    if (this.onAgentThought) {
      this.onAgentThought(agentKey, thought);
    }
  }

  emitConfidence(agentKey, percent) {
    if (this.onConfidenceUpdate) {
      this.onConfidenceUpdate(agentKey, percent);
    }
  }

  emitTerminal(line, type = 'normal') {
    if (this.onTerminalLog) {
      this.onTerminalLog(line, type);
    }
  }

  /**
   * Start the 4-Agent Autonomous Incident Resolution Pipeline
   */
  async startIncidentPipeline() {
    if (!this.currentScenario || this.isProcessing) return;
    this.isProcessing = true;
    this.isCallActive = true;

    if (this.onCallStatusChange) this.onCallStatusChange('CONNECTED');
    soundEngine.playConnect();

    // =========================================================================
    // STEP 1: CALL-E Operator (Voice & Dispatch)
    // =========================================================================
    this.currentStep = 1;
    if (this.onStepChange) this.onStepChange(1);
    
    this.emitThought('operator', `Call connected. Triaging ${this.currentScenario.service} exception...`);
    this.emitConfidence('operator', 92);
    this.emitTerminal(`>>> [CALL-E SRE] INCOMING CALL ESTABLISHED: ${this.currentScenario.service}`, 'cyan');
    this.emitTerminal(`>>> Telemetry stream attached: Severity = ${this.currentScenario.severity}`, 'amber');
    
    this.emitMessage('CALL-E Operator', `Lead engineer verified on line. Outage detected in ${this.currentScenario.service}. Dispatching telemetry payload to Inspector Tracer.`, 'operator');
    
    const sleep = (ms) => new Promise(r => setTimeout(r, typeof window === 'undefined' ? 5 : ms));

    // Speak first debrief line over voice
    await speechEngine.speak(`Hello Lead Engineer. This is CALL-E. Emergency alert in ${this.currentScenario.service}. A critical exception has been intercepted. The council is initiating diagnosis.`);

    await sleep(600);

    // =========================================================================
    // STEP 2: Inspector Tracer (Root-Cause Detective)
    // =========================================================================
    this.currentStep = 2;
    if (this.onStepChange) this.onStepChange(2);

    this.emitThought('tracer', `Traversing AST call tree for ${this.currentScenario.fileName}...`);
    this.emitConfidence('tracer', 65);
    this.emitTerminal(`>>> [INSPECTOR TRACER] Parsing stack trace and AST nodes...`, 'cyan');
    this.emitTerminal(this.currentScenario.stackTrace.split('\n')[0], 'red');

    await sleep(900);

    this.emitConfidence('tracer', 99);
    this.emitThought('tracer', `Root cause isolated: ${this.currentScenario.rcaReport.vulnerabilityClass}`);
    
    this.emitMessage('Inspector Tracer', `Root cause confirmed at ${this.currentScenario.fileName}. ${this.currentScenario.rcaReport.rootCause}`, 'tracer');
    this.emitTerminal(`[RCA IDENTIFIED] ${this.currentScenario.rcaReport.rootCause}`, 'amber');
    this.emitTerminal(`[OFFENDING COMMIT] ${this.currentScenario.rcaReport.offendingCommit}`, 'dim');

    // CALL-E Operator updates user via voice
    await speechEngine.speak(`Inspector Tracer has isolated the root cause. It is a ${this.currentScenario.rcaReport.vulnerabilityClass.split(':')[0]}. Patch Architect is generating the zero-downtime hotfix.`);

    await sleep(700);

    // =========================================================================
    // STEP 3: Patch Architect (Vulcan Synthesizer)
    // =========================================================================
    this.currentStep = 3;
    if (this.onStepChange) this.onStepChange(3);

    this.emitThought('architect', `Synthesizing atomic patch and unified diff for ${this.currentScenario.fileName}...`);
    this.emitConfidence('architect', 78);
    this.emitTerminal(`>>> [PATCH ARCHITECT] Synthesizing AST-safe defensive patch...`, 'cyan');
    this.emitTerminal(`Applying recommended mitigation: ${this.currentScenario.rcaReport.recommendedFix}`, 'dim');

    await sleep(1100);

    this.emitConfidence('architect', 97);
    this.emitThought('architect', `Patch synthesized with backward-compatibility safety checks.`);
    this.emitMessage('Patch Architect', `Unified hotfix diff generated. Hardening applied: ${this.currentScenario.rcaReport.recommendedFix}`, 'architect');

    if (this.onCodeReady) {
      this.onCodeReady(this.currentScenario);
    }

    await speechEngine.speak(`Patch Architect has compiled the hotfix with zero-downtime safety checks. Quality Guardian is executing regression tests in isolated sandbox.`);

    await sleep(800);

    // =========================================================================
    // STEP 4: Quality Guardian (Sentinel SRE & QA)
    // =========================================================================
    this.currentStep = 4;
    if (this.onStepChange) this.onStepChange(4);

    this.emitThought('guardian', `Spinning up sandbox container and running simulated test suite...`);
    this.emitConfidence('guardian', 60);

    this.emitTerminal(`>>> [QUALITY GUARDIAN] Initializing isolated V8 sandbox runner...`, 'cyan');
    this.emitTerminal(`$ npm test -- --runInBand --detectOpenHandles`, 'dim');
    
    // Simulate initial fail on unpatched code
    await sleep(800);
    soundEngine.playWarningBuzzer();
    this.emitTerminal(`FAIL ${this.currentScenario.fileName}`, 'red');
    this.emitTerminal(`  ✕ Regression test failed on unpatched code (concurrency violation)`, 'red');
    
    // Apply patch and rerun
    await sleep(900);
    this.emitTerminal(`Applying Patch Architect unified diff to sandbox container...`, 'dim');
    this.emitTerminal(`$ npm test (re-running against hotfix patch)...`, 'cyan');

    await sleep(1100);
    soundEngine.playSuccessFanfare();
    this.emitTerminal(`PASS ${this.currentScenario.fileName}`, 'green');
    this.emitTerminal(`  ✓ Concurrency / Vulnerability test passed (32ms)`, 'green');
    this.emitTerminal(`  ✓ Memory footprint nominal: 0 sockets leaked`, 'green');
    this.emitTerminal(`  ✓ All 12 unit & integration assertions passed`, 'green');

    this.emitConfidence('guardian', 100);
    this.emitThought('guardian', `All regression tests passed. Holding for human authorisation.`);
    this.emitMessage('Quality Guardian', `Verification complete in the sandbox. The patch is staged but NOT applied to production. Nothing ships until a human authorises it on the call.`, 'guardian');

    // =========================================================================
    // STEP 5: Human Authorisation Gate
    //
    // This is the point of the whole product. The council has done everything it
    // can do on its own, and now it stops. Production does not change until a
    // person says so out loud on a phone call.
    // =========================================================================
    this.currentStep = 5;
    if (this.onStepChange) this.onStepChange(5);
    this.awaitingAuthorisation = true;

    this.emitTerminal(`>>> [AUTHORISATION GATE] Patch staged. Production unchanged.`, 'amber');
    this.emitTerminal(`>>> Waiting on a spoken decision from the on-call rota...`, 'amber');
    if (this.onAuthorisationRequired) this.onAuthorisationRequired(this.currentScenario);

    await speechEngine.speak(`Verification succeeded and the regression suite is green in the sandbox. I am not deploying anything yet. I need a spoken decision from the on-call engineer before production changes.`);

    this.isProcessing = false;
  }

  /**
   * Applies the decision that came back from the phone call.
   *
   * The structured result from CALL-E is the only thing that can move
   * production. A decision that was not authorised by a reached human closes
   * the gate rather than opening it.
   */
  async applyLadderOutcome(outcome) {
    if (!outcome) return;
    this.awaitingAuthorisation = false;
    this.lastOutcome = outcome;

    const who = outcome.decidedBy?.name || 'the on-call rota';

    if (outcome.authorised && outcome.decision === 'deploy_hotfix') {
      this.emitMessage('CALL-E Operator', `Deployment authorised by ${who} on the call. Reason recorded: "${outcome.reason}"`, 'operator');
      this.emitTerminal(`[AUTHORISED] ${who} approved deployment by voice.`, 'green');
      this.emitTerminal(`[DEPLOY] Canary rollout: 10% -> 50% -> 100% with automatic rollback guard.`, 'green');
      this.emitThought('guardian', `Deployment authorised by ${who}. Canary rollout in progress.`);
      soundEngine.playSuccessFanfare();
      await speechEngine.speak(`Deployment authorised by ${who}. Rolling the hotfix out through canary now.`);
      return;
    }

    if (outcome.authorised && outcome.decision === 'rollback_release') {
      this.emitMessage('CALL-E Operator', `Rollback authorised by ${who}. Reverting the last release instead of patching forward.`, 'operator');
      this.emitTerminal(`[AUTHORISED] ${who} chose rollback over hotfix.`, 'amber');
      this.emitTerminal(`[ROLLBACK] Reverting to previous known-good release tag.`, 'amber');
      this.emitThought('guardian', `Rollback authorised by ${who}. Hotfix parked on a branch.`);
      soundEngine.playSuccessFanfare();
      await speechEngine.speak(`Rollback authorised by ${who}. Reverting to the last known good release.`);
      return;
    }

    if (outcome.decision === 'hold_for_review') {
      this.emitMessage('CALL-E Operator', `${who} held the hotfix for review. Production is unchanged.`, 'operator');
      this.emitTerminal(`[HELD] ${who} declined automatic deployment. Reason: ${outcome.reason}`, 'amber');
      this.emitThought('guardian', `Hotfix held pending human review. No production change made.`);
      await speechEngine.speak(`Understood. The hotfix is held for review and production is unchanged.`);
      return;
    }

    this.emitMessage('CALL-E Operator', `No authorisation obtained. ${outcome.reason}`, 'operator');
    this.emitTerminal(`[BLOCKED] Deployment blocked: no human authorised the change.`, 'red');
    this.emitThought('guardian', `Deployment blocked. Nobody on the rota authorised a production change.`);
    soundEngine.playWarningBuzzer();
    await speechEngine.speak(`I could not obtain an authorisation from the on-call rota. Production is unchanged and the incident stays open.`);
  }

  /**
   * Handle user voice or text query during an active call
   */
  async handleUserQuery(userQuery) {
    if (!userQuery || !userQuery.trim()) return;

    this.emitMessage('Lead Engineer (You)', userQuery, 'user');
    const q = userQuery.toLowerCase();

    if (q.includes('root cause') || q.includes('why') || q.includes('cause')) {
      await speechEngine.speak(`The root cause was ${this.currentScenario.rcaReport.rootCause}`);
    } else if (q.includes('deploy') || q.includes('merge') || q.includes('ship')) {
      // Authorising from the console is a different trust path than authorising
      // by phone, and the audit trail records which one was used.
      await this.applyLadderOutcome({
        authorised: true,
        decision: 'deploy_hotfix',
        reason: 'Authorised in the web console by the signed-in engineer.',
        decidedBy: { name: 'Console operator' },
        confidence: null,
        channel: 'console'
      });
    } else if (q.includes('hold') || q.includes('wait') || q.includes('stop')) {
      await this.applyLadderOutcome({
        authorised: false,
        decision: 'hold_for_review',
        reason: 'Held in the web console by the signed-in engineer.',
        decidedBy: { name: 'Console operator' },
        confidence: null,
        channel: 'console'
      });
    } else if (q.includes('test') || q.includes('verify')) {
      await speechEngine.speak(`All 12 sandbox regression tests passed with zero latency regression.`);
    } else {
      await speechEngine.speak(`Understood. The 4-agent council has verified the fix and is standing by for your authorization.`);
    }
  }
}
