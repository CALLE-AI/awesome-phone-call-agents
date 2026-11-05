import { PhoneAgentProvider } from './PhoneAgentProvider.js';
import { maskPhoneNumber } from '../utils/phone.js';
import {
  CallRecord,
  CallState,
  CallTranscriptTurn,
  StructuredAnswer,
  StructuredCallResult,
  VerificationTask,
} from '../types/index.js';

interface ActiveMockCall {
  startTime: number;
  task: VerificationTask;
  idempotencyKey: string;
}

export class MockProvider implements PhoneAgentProvider {
  private activeCalls: Map<string, ActiveMockCall> = new Map();

  async startVerificationCall(
    task: VerificationTask,
    idempotencyKey: string
  ): Promise<{ callId: string; initialRecord: CallRecord }> {
    const callId = `mock_call_${task.id}_${Date.now()}`;

    this.activeCalls.set(callId, {
      startTime: Date.now(),
      task,
      idempotencyKey,
    });

    const initialRecord: CallRecord = {
      id: `call_${task.id}`,
      taskId: task.id,
      providerCallId: callId,
      idempotencyKey,
      phoneNumber: task.target.phoneNumber,
      mode: 'MOCK',
      callState: 'QUEUED',
      startedAt: new Date().toISOString(),
      durationSeconds: 0,
      transcriptTurns: [
        {
          id: 'turn_init',
          timestamp: '00:00',
          speaker: 'AI',
          text: `[MOCK DEMO] Initializing simulated verification call to ${task.target.organizationName} (${maskPhoneNumber(task.target.phoneNumber)})...`,
          isSimulated: true,
        },
      ],
      structuredResult: null,
      responderType: 'human',
    };

    return { callId, initialRecord };
  }

  async getCallProgress(callId: string, task: VerificationTask): Promise<CallRecord> {
    const session = this.activeCalls.get(callId);
    const elapsedSeconds = session ? Math.floor((Date.now() - session.startTime) / 1000) : 15;

    // Check if task already has a pre-packaged finished demo record
    if (task.callRecord && task.callRecord.callState === 'COMPLETED' && !session) {
      return task.callRecord;
    }

    let callState: CallState = 'IN_PROGRESS';
    const turns: CallTranscriptTurn[] = [];

    const supplierName = task.target.organizationName || 'ABC Components';
    const repName = task.target.contactPerson || 'David (Inventory Dispatch)';
    const item = task.item || task.subject || 'microcontroller units';

    // Parse claimed quantity if provided
    let claimedNum = 500;
    if (task.digitalClaim?.expectedQuantity) {
      const match = String(task.digitalClaim.expectedQuantity).match(/\d+/);
      if (match) claimedNum = parseInt(match[0], 10);
    }

    // Realistic verified count (e.g. 320 when claimed 500, or exact)
    const verifiedNum = claimedNum > 50 ? Math.round(claimedNum * 0.64) : claimedNum;

    // Turn 1: Ringing & Supplier greeting
    turns.push({
      id: 'turn_1',
      timestamp: '00:03',
      speaker: 'STAFF',
      text: `[MOCK DEMO] ${supplierName} dispatch and sales department, this is ${repName}. How can I assist with your supply order today?`,
      isSimulated: true,
    });

    if (elapsedSeconds >= 4) {
      // Turn 2: TRACE Agent inquiring on item, quantity & goal
      turns.push({
        id: 'turn_2',
        timestamp: '00:07',
        speaker: 'AI',
        text: `[MOCK DEMO] Hello, I am calling on behalf of TRACE Operational Verification regarding ${item}. We are verifying physical inventory availability and confirmed delivery timelines for ${task.verificationGoal}.`,
        isSimulated: true,
      });
    }

    if (elapsedSeconds >= 8) {
      // Turn 3: Representative providing specific numbers & terms
      turns.push({
        id: 'turn_3',
        timestamp: '00:15',
        speaker: 'STAFF',
        text: `[MOCK DEMO] Let me check our warehouse management system. For ${item}: we currently have ${verifiedNum} units physically in stock and ready for release. We can ship the first ${verifiedNum} units within 3 business days; additional quantities have a 7-day standard factory lead time.`,
        isSimulated: true,
      });
    }

    if (elapsedSeconds >= 12) {
      // Turn 4: TRACE Agent confirming details
      turns.push({
        id: 'turn_4',
        timestamp: '00:22',
        speaker: 'AI',
        text: `[MOCK DEMO] Thank you ${repName}. To confirm: ${verifiedNum} units are verified in stock today for immediate release. We have recorded the 7-day lead time for additional volume. Thank you for your cooperation!`,
        isSimulated: true,
      });
      callState = 'COMPLETED';
    }

    // Build structured result on completion
    let structuredResult: StructuredCallResult | null = null;
    if (callState === 'COMPLETED' || elapsedSeconds >= 12) {
      const answersMap: Record<string, StructuredAnswer> = {};

      task.questions.forEach((q, idx) => {
        let sampleAns: any = `Confirmed ${verifiedNum} units in warehouse`;
        if (q.expectedType === 'boolean') sampleAns = true;
        if (q.expectedType === 'number') sampleAns = verifiedNum;
        if (q.question.toLowerCase().includes('lead time') || q.question.toLowerCase().includes('how long')) {
          sampleAns = '7 days standard factory lead time';
        } else if (q.question.toLowerCase().includes('delivery') || q.question.toLowerCase().includes('when')) {
          sampleAns = 'Immediate dispatch within 3 days for stock units';
        } else if (q.question.toLowerCase().includes('quantity') || q.question.toLowerCase().includes('how many')) {
          sampleAns = `${verifiedNum} units`;
        }

        answersMap[q.id] = {
          questionId: q.id,
          question: q.question,
          expectedType: q.expectedType,
          answer: sampleAns,
          confidence: 'high',
          evidence: `Supplier confirmed ${verifiedNum} units in physical inventory with 3-day release.`,
        };
      });

      structuredResult = {
        call_outcome: 'confirmed',
        verification_confidence: 'high',
        availability_status: 'available',
        quantity_or_capacity: `${verifiedNum} units`,
        next_available_time: 'Immediate release within 3 days',
        lead_time: '7 days',
        unit_price: '$14.20 / unit',
        contact_name: repName,
        responder_type: 'human',
        notes: `Physical inventory verified at ${verifiedNum} units for immediate dispatch. 7-day lead time applies to backlog quantities.`,
        evidence: [
          `We currently have ${verifiedNum} units physically in stock and ready for release.`,
          `We can ship the first ${verifiedNum} units within 3 business days.`,
          `Additional quantities have a 7-day standard factory lead time.`,
        ],
        question_answers: answersMap,
      };
    }

    const duration = Math.min(elapsedSeconds, 24);

    return {
      id: `call_${task.id}`,
      taskId: task.id,
      providerCallId: callId,
      idempotencyKey: session?.idempotencyKey || `key_${task.id}`,
      phoneNumber: task.target.phoneNumber,
      mode: 'MOCK',
      callState,
      startedAt: session ? new Date(session.startTime).toISOString() : new Date().toISOString(),
      completedAt: callState === 'COMPLETED' ? new Date().toISOString() : undefined,
      durationSeconds: duration,
      transcriptTurns: turns,
      structuredResult,
      responderType: 'human',
    };
  }
}

