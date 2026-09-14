import { Employee, CoverageRequest, CallAttempt, CoverageWorkflowState, TimelineEvent, CallStructuredResult } from '@/types';
import { db } from './db';
import { calleClient } from './calle';

export class CoverageEngine {
  private activeRuns: Map<string, boolean> = new Map();

  /**
   * Initializes a coverage search workflow
   */
  async startCoverage(
    request: CoverageRequest,
    mode: 'live' | 'simulation' = 'live'
  ): Promise<CoverageWorkflowState> {
    const qualifiedStaff = db.getStaffByRole(request.role);

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const timeline: TimelineEvent[] = [
      {
        id: `tl_${Date.now()}_1`,
        timestamp: now,
        title: 'Coverage request created',
        description: `Need ${request.workersNeeded} ${request.role} for ${request.date} (${request.startTime} – ${request.endTime}) at ${request.location}.`,
        type: 'info'
      },
      {
        id: `tl_${Date.now()}_2`,
        timestamp: now,
        title: `${qualifiedStaff.length} qualified staff identified`,
        description: `Filtered eligible roster: ${qualifiedStaff.map(s => s.name).join(', ')}.`,
        type: 'info'
      }
    ];

    if (qualifiedStaff.length === 0) {
      timeline.push({
        id: `tl_${Date.now()}_3`,
        timestamp: now,
        title: 'No eligible staff found',
        description: `No employees with role "${request.role}" exist in staff pool.`,
        type: 'error'
      });

      const failedState: CoverageWorkflowState = {
        requestId: request.id,
        request: { ...request, status: 'no_coverage' },
        candidates: [],
        currentIndex: 0,
        attempts: [],
        status: 'no_coverage',
        timeline,
        mode,
        error: `No employees with role "${request.role}" found in staff roster.`
      };
      db.setActiveWorkflow(failedState);
      return failedState;
    }

    const state: CoverageWorkflowState = {
      requestId: request.id,
      request: { ...request, status: 'searching' },
      candidates: qualifiedStaff,
      currentIndex: 0,
      attempts: [],
      status: 'searching',
      timeline,
      mode
    };

    db.setActiveWorkflow(state);
    this.activeRuns.set(request.id, true);

    // Launch background sequential dialer without blocking HTTP response
    this.runSequentialLoop(request.id, mode).catch(err => {
      console.error('Sequential loop error:', err);
      const current = db.getActiveWorkflow();
      if (current && current.requestId === request.id) {
        current.status = 'failed';
        current.error = err.message;
        db.setActiveWorkflow({ ...current });
      }
    });

    return state;
  }

  /**
   * Main sequential orchestrator loop
   */
  private async runSequentialLoop(requestId: string, mode: 'live' | 'simulation') {
    while (this.activeRuns.get(requestId)) {
      const state = db.getActiveWorkflow();
      if (!state || state.requestId !== requestId) break;
      if (state.status !== 'searching') break;

      const candidateIndex = state.currentIndex;
      if (candidateIndex >= state.candidates.length) {
        // Reached end of candidate list with no confirmed coverage
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        state.status = 'no_coverage';
        state.timeline.push({
          id: `tl_${Date.now()}`,
          timestamp: now,
          title: 'Coverage search ended',
          description: 'All qualified employees were contacted, but no coverage was secured.',
          type: 'warning'
        });
        db.setActiveWorkflow({ ...state });
        this.activeRuns.delete(requestId);
        break;
      }

      const candidate = state.candidates[candidateIndex];

      // Duplicate Call Protection Check (Section 20)
      const alreadyCalled = state.attempts.some(
        a => a.employeeId === candidate.id && a.status === 'completed'
      );
      if (alreadyCalled) {
        state.currentIndex += 1;
        db.setActiveWorkflow({ ...state });
        continue;
      }

      // Execute Call to this candidate
      await this.executeCallToCandidate(state, candidate, candidateIndex, mode);

      // Re-read updated state after call
      const updated = db.getActiveWorkflow();
      if (!updated || updated.requestId !== requestId) break;

      // Evaluate stopping condition
      if (updated.status === 'covered') {
        this.activeRuns.delete(requestId);
        break;
      } else if (updated.status === 'conditional_review') {
        // Paused for manager review
        this.activeRuns.delete(requestId);
        break;
      } else {
        // Move to next employee
        updated.currentIndex += 1;
        db.setActiveWorkflow({ ...updated });
      }
    }
  }

  /**
   * Calls a single candidate via CALL-E or simulation replay
   */
  private async executeCallToCandidate(
    state: CoverageWorkflowState,
    candidate: Employee,
    attemptIndex: number,
    mode: 'live' | 'simulation'
  ) {
    const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Idempotency key per Section 20
    const idempotencyKey = `shiftsync_${state.requestId}_${candidate.id}_att1`;

    const attempt: CallAttempt = {
      id: `att_${Date.now()}_${candidate.id}`,
      requestId: state.requestId,
      employeeId: candidate.id,
      employeeName: candidate.name,
      phone: candidate.phone,
      attemptNumber: attemptIndex + 1,
      status: 'calling',
      outcome: 'calling',
      startedAt: new Date().toISOString(),
      isSimulated: mode === 'simulation'
    };

    state.attempts.push(attempt);
    state.timeline.push({
      id: `tl_${Date.now()}_call`,
      timestamp: nowTime(),
      title: `Calling ${candidate.name}`,
      description: `Dialing ${candidate.phone} (${candidate.role}, priority #${candidate.priority || 1})...`,
      type: 'call'
    });
    db.setActiveWorkflow({ ...state });

    if (mode === 'simulation') {
      await this.simulateCallResult(state, attempt, candidate, attemptIndex);
    } else {
      await this.performRealCalleCall(state, attempt, candidate, idempotencyKey);
    }
  }

  /**
   * Real CALL-E call lifecycle with polling and structured result normalization
   */
  private async performRealCalleCall(
    state: CoverageWorkflowState,
    attempt: CallAttempt,
    candidate: Employee,
    idempotencyKey: string
  ) {
    const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    try {
      const { callId, initialStatus } = await calleClient.createCall({
        idempotencyKey,
        phone: candidate.phone,
        employeeName: candidate.name,
        businessName: state.request.businessName || 'The Copper Bistro',
        role: state.request.role,
        shiftDate: state.request.date,
        startTime: state.request.startTime,
        endTime: state.request.endTime,
        location: state.request.location
      });

      attempt.calleCallId = callId;
      attempt.status = 'calling';
      db.setActiveWorkflow({ ...state });

      // Poll until terminal status (max 4 minutes with 6s intervals)
      let terminal = false;
      let iterations = 0;
      const maxIterations = 40;

      while (!terminal && iterations < maxIterations) {
        await new Promise(res => setTimeout(res, 6000));
        iterations++;

        const callData = await calleClient.getCall(callId);
        if (callData.status === 'completed' || callData.status === 'failed' || callData.status === 'canceled') {
          terminal = true;
          attempt.status = callData.status === 'completed' ? 'completed' : 'failed';
          attempt.completedAt = new Date().toISOString();
          attempt.summary = callData.summary || 'Call completed';
          attempt.transcriptTurns = calleClient.extractTranscript(callData);

          // Normalize result
          const normResult = calleClient.normalizeResult(callData, candidate.name, state.request.date);
          attempt.structuredResult = normResult;
          attempt.outcome = normResult.status;

          this.processOutcome(state, candidate, attempt, normResult);
          break;
        }
      }

      if (!terminal) {
        attempt.status = 'failed';
        attempt.outcome = 'no_answer';
        attempt.summary = 'Call timed out without terminal response.';
        state.timeline.push({
          id: `tl_${Date.now()}_timeout`,
          timestamp: nowTime(),
          title: `${candidate.name} timed out`,
          description: 'No response from recipient within timeout window.',
          type: 'warning'
        });
        db.setActiveWorkflow({ ...state });
      }
    } catch (err: any) {
      console.error(`CALL-E error calling ${candidate.name}:`, err);
      attempt.status = 'failed';
      attempt.outcome = 'unknown';
      attempt.summary = `Call error: ${err.message}`;
      state.timeline.push({
        id: `tl_${Date.now()}_err`,
        timestamp: nowTime(),
        title: `Call failed for ${candidate.name}`,
        description: err.message || 'Network or authorization failure.',
        type: 'error'
      });
      db.setActiveWorkflow({ ...state });
    }
  }

  /**
   * Processes the structured outcome and updates workflow status
   */
  private processOutcome(
    state: CoverageWorkflowState,
    candidate: Employee,
    attempt: CallAttempt,
    result: CallStructuredResult
  ) {
    const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (result.status === 'accepted') {
      state.status = 'covered';
      state.confirmedEmployee = candidate;
      state.confirmedResult = result;
      state.timeline.push({
        id: `tl_${Date.now()}_acc`,
        timestamp: nowTime(),
        title: `Coverage Confirmed by ${candidate.name}`,
        description: `${candidate.name} accepted the shift (${state.request.startTime} – ${state.request.endTime}). Workflow stopped.`,
        type: 'success'
      });
    } else if (result.status === 'conditional') {
      state.status = 'conditional_review';
      state.confirmedEmployee = candidate;
      state.confirmedResult = result;
      state.timeline.push({
        id: `tl_${Date.now()}_cond`,
        timestamp: nowTime(),
        title: `⚠️ Conditional Availability from ${candidate.name}`,
        description: `${candidate.name} offered coverage available from ${result.available_from || 'alternate time'}. Manager review required.`,
        type: 'warning'
      });
    } else if (result.status === 'declined') {
      state.timeline.push({
        id: `tl_${Date.now()}_dec`,
        timestamp: nowTime(),
        title: `${candidate.name} Declined`,
        description: `${candidate.name} cannot work this shift. Moving to next candidate.`,
        type: 'info'
      });
    } else {
      state.timeline.push({
        id: `tl_${Date.now()}_unr`,
        timestamp: nowTime(),
        title: `${candidate.name} Unreached (${result.status})`,
        description: `Could not connect. Moving to next candidate.`,
        type: 'info'
      });
    }

    db.setActiveWorkflow({ ...state });
  }

  /**
   * Simulation mode: replay realistic outcomes for Alex -> David -> James
   */
  private async simulateCallResult(
    state: CoverageWorkflowState,
    attempt: CallAttempt,
    candidate: Employee,
    index: number
  ) {
    // 3-second realistic pause
    await new Promise(res => setTimeout(res, 3000));

    let outcome: CallStructuredResult['status'] = 'declined';
    let availableFrom: string | null = null;
    let notes = '';
    let transcript: Array<{ speaker: string; text: string }> = [];

    // Pre-scripted scenario:
    // Candidate 0 (Alex) -> Declines
    // Candidate 1 (David) -> No Answer
    // If request contains conditional keyword or Elena -> Conditional (7 PM)
    // Candidate 2 (James) -> Accepts
    if (state.request.scenario === 'conditional') {
      outcome = 'conditional';
      availableFrom = '7:00 PM';
      notes = `${candidate.name} can cover but cannot arrive until 7:00 PM.`;
      transcript = [
        { speaker: 'bot', text: `Hi ${candidate.name}, this is ShiftSync calling from The Copper Bistro. We have an urgent open shift for a ${state.request.role} tonight from ${state.request.startTime} to ${state.request.endTime}. Can you cover?` },
        { speaker: 'user', text: "I can come, but I can't make it until 7 PM." },
        { speaker: 'bot', text: "Thank you, I've recorded that you can work starting at 7:00 PM. I will flag this for manager approval. Have a great day!" }
      ];
    } else if (index === 0) {
      outcome = 'declined';
      notes = `${candidate.name} has family dinner commitments and cannot cover tonight.`;
      transcript = [
        { speaker: 'bot', text: `Hi ${candidate.name}, this is ShiftSync calling from The Copper Bistro. We have an urgent open shift for a ${state.request.role} tonight from ${state.request.startTime} to ${state.request.endTime}. Can you cover?` },
        { speaker: 'user', text: 'Hey, sorry but I have family in town tonight so I cannot make it.' },
        { speaker: 'bot', text: `No problem at all ${candidate.name}, thank you for letting us know! Have a great evening.` }
      ];
    } else if (index === 1) {
      outcome = 'no_answer';
      notes = 'Line rang 5 times, diverted to voicemail without live answer.';
      transcript = [
        { speaker: 'bot', text: `Calling ${candidate.name}...` }
      ];
    } else {
      // 3rd candidate -> Accepts
      outcome = 'accepted';
      availableFrom = state.request.startTime;
      notes = `${candidate.name} confirmed availability and will arrive on time.`;
      transcript = [
        { speaker: 'bot', text: `Hi ${candidate.name}, this is ShiftSync calling from The Copper Bistro. We have an urgent open shift for a ${state.request.role} tonight from ${state.request.startTime} to ${state.request.endTime}. Can you cover?` },
        { speaker: 'user', text: 'Yes, I was just looking at my schedule. I can definitely take that shift!' },
        { speaker: 'bot', text: `Great, I have noted that you can cover the ${state.request.role} shift tonight from ${state.request.startTime} to ${state.request.endTime}. Thank you, see you then!` }
      ];
    }

    attempt.status = outcome === 'no_answer' ? 'failed' : 'completed';
    attempt.completedAt = new Date().toISOString();
    attempt.outcome = outcome;
    attempt.summary = notes;
    attempt.transcriptTurns = transcript;

    const structuredResult: CallStructuredResult = {
      status: outcome,
      employee_name: candidate.name,
      shift_date: state.request.date,
      available_from: availableFrom,
      notes,
      manager_review_required: (outcome as string) === 'conditional'
    };
    attempt.structuredResult = structuredResult;

    this.processOutcome(state, candidate, attempt, structuredResult);
  }

  /**
   * Manager action: Approve conditional coverage
   */
  approveConditional(requestId: string): CoverageWorkflowState | null {
    const state = db.getActiveWorkflow();
    if (!state || state.requestId !== requestId) return null;

    state.status = 'covered';
    state.timeline.push({
      id: `tl_${Date.now()}_appr`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      title: 'Conditional Coverage Approved by Manager',
      description: `Manager accepted ${state.confirmedEmployee?.name}'s modified arrival time (${state.confirmedResult?.available_from || 'alternate'}).`,
      type: 'success'
    });

    db.setActiveWorkflow({ ...state });
    return state;
  }

  /**
   * Manager action: Reject conditional and proceed to next candidate
   */
  async rejectConditionalAndContinue(requestId: string): Promise<CoverageWorkflowState | null> {
    const state = db.getActiveWorkflow();
    if (!state || state.requestId !== requestId) return null;

    state.status = 'searching';
    state.currentIndex += 1;
    state.confirmedEmployee = undefined;
    state.confirmedResult = undefined;
    state.timeline.push({
      id: `tl_${Date.now()}_rej`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      title: 'Conditional Offer Passed',
      description: 'Manager opted to continue calling remaining qualified staff.',
      type: 'info'
    });

    db.setActiveWorkflow({ ...state });
    this.activeRuns.set(requestId, true);

    this.runSequentialLoop(requestId, state.mode).catch(err => {
      console.error('Continue loop error:', err);
    });

    return state;
  }

  /**
   * Stop an active coverage search
   */
  cancelCoverage(requestId: string) {
    this.activeRuns.delete(requestId);
    const state = db.getActiveWorkflow();
    if (state && state.requestId === requestId) {
      state.status = 'no_coverage';
      state.timeline.push({
        id: `tl_${Date.now()}_stop`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        title: 'Search Stopped Manually',
        description: 'Manager stopped the automated calling search.',
        type: 'warning'
      });
      db.setActiveWorkflow({ ...state });
    }
  }
}

export const coverageEngine = new CoverageEngine();
