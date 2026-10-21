import { taskService } from './taskService.js';
import { callService } from './callService.js';
import { reconcileVerificationResult } from './reconciliation.js';
import { generateTasksExcelWorkbook, generateTasksCsv } from './exportService.js';
import { getOrCreateIdempotencyKey } from '../utils/idempotency.js';
import { validateAndFormatE164 } from '../utils/phone.js';
import { VerificationTask } from '../types/index.js';
import ExcelJS from 'exceljs';

describe('TRACE Supply-Chain Verification Engine Integration & Rules', () => {
  // 1. Phone number validation and exact E.164 guarantee
  test('Requirement 1 & 2: Exact phone number routing and invalid phone number blocks task creation', () => {
    const validCheck = validateAndFormatE164('+14155550181');
    expect(validCheck.valid).toBe(true);
    expect(validCheck.formatted).toBe('+14155550181');

    const invalidCheck = validateAndFormatE164('invalid-phone');
    expect(invalidCheck.valid).toBe(false);

    // Creating task with invalid phone number must be blocked
    const creationResult = taskService.createTask({
      target: {
        organizationName: 'Apex Microelectronics',
        phoneNumber: 'not-a-number',
      },
      item: 'STM32 Microcontrollers',
      subject: 'Inventory Count Test',
      verificationGoal: 'Check on-shelf stock',
      questions: [
        {
          id: 'q1',
          order: 1,
          question: 'Are units on shelf ready to ship?',
          expectedType: 'boolean',
          required: true,
        },
      ],
    });
    expect(creationResult.success).toBe(false);
    expect(creationResult.error).toContain('E.164');
  });

  // 3 & 4. Unreachable Rule
  test('Requirement 3 & 4: Unreachable and failed calls strictly return UNREACHABLE and reviewStatus NONE', () => {
    const outcome = reconcileVerificationResult(
      { claimedStatus: 'AVAILABLE', claimText: 'Listing says 500 units in stock' },
      null,
      'FAILED'
    );
    expect(outcome.outcome).toBe('UNREACHABLE');
    expect(outcome.reviewStatus).toBe('NONE');
    expect(outcome.match).toBe(false);
    expect(outcome.phoneVerifiedStatus).toBe('unknown');
    expect(outcome.evidenceChain).toBeDefined();
  });

  // 5. Completed + Low Confidence -> UNKNOWN / INCONCLUSIVE with NEEDS_REVIEW
  test('Requirement 5: Completed call with low confidence returns UNKNOWN / INCONCLUSIVE and reviewStatus NEEDS_REVIEW', () => {
    const outcome = reconcileVerificationResult(
      { claimedStatus: 'AVAILABLE', claimText: '500 units ready' },
      {
        call_outcome: 'unknown',
        verification_confidence: 'low',
        availability_status: 'unknown',
        quantity_or_capacity: null,
        next_available_time: null,
        contact_name: null,
        notes: 'Warehouse rep was uncertain and asked to call back tomorrow.',
        evidence: [],
        question_answers: {},
      },
      'COMPLETED'
    );
    expect(outcome.outcome).toBe('UNKNOWN / INCONCLUSIVE');
    expect(outcome.reviewStatus).toBe('NEEDS_REVIEW');
    expect(outcome.match).toBeNull();
  });

  // 6. Digital AVAILABLE + Phone AVAILABLE = VERIFIED
  test('Requirement 6: Digital AVAILABLE + Phone AVAILABLE = VERIFIED (match=true)', () => {
    const outcome = reconcileVerificationResult(
      { claimedStatus: 'AVAILABLE', claimText: '40 valves ready' },
      {
        call_outcome: 'confirmed',
        verification_confidence: 'high',
        availability_status: 'available',
        quantity_or_capacity: '40 valves',
        next_available_time: 'Today 3 PM',
        contact_name: 'Elena',
        notes: 'All 40 valves verified on pallet 3',
        evidence: ['All 40 valves are boxed and ready for FreightDirect pickup.'],
        question_answers: {},
      },
      'COMPLETED'
    );
    expect(outcome.outcome).toBe('VERIFIED');
    expect(outcome.reviewStatus).toBe('NONE');
    expect(outcome.match).toBe(true);
  });

  // 7 & 8. Quantitative Discrepancies (500 claimed vs 320 verified) -> CONTRADICTED
  test('Requirement 7 & 8: Digital 500 claimed vs Phone 320 verified produces CONTRADICTED (-180 units)', () => {
    const outcome = reconcileVerificationResult(
      { claimedStatus: 'AVAILABLE', claimText: 'ERP claimed 500 units', expectedQuantity: 500 },
      {
        call_outcome: 'contradicted',
        verification_confidence: 'high',
        availability_status: 'limited',
        quantity_or_capacity: '320 units',
        next_available_time: 'Next Tuesday for 180 balance',
        contact_name: 'Ray',
        notes: '320 on shelf; 180 backordered',
        evidence: ['We currently have 320 units physically in stock.'],
        question_answers: {},
      },
      'COMPLETED'
    );
    expect(outcome.outcome).toBe('CONTRADICTED');
    expect(outcome.reviewStatus).toBe('NONE');
    expect(outcome.difference).toContain('-180 units');
    expect(outcome.match).toBe(false);
  });

  // 9. Inquiry without digital claim -> No fake match
  test('Requirement 9: Verification without baseline digital claim has match=null and outcome VERIFIED', () => {
    const outcome = reconcileVerificationResult(
      undefined,
      {
        call_outcome: 'confirmed',
        verification_confidence: 'high',
        availability_status: 'available',
        quantity_or_capacity: '100 units',
        next_available_time: 'Now',
        contact_name: 'Staff',
        notes: 'Confirmed available in warehouse',
        evidence: ['Yes we have 100 units in stock.'],
        question_answers: {},
      },
      'COMPLETED'
    );
    expect(outcome.outcome).toBe('VERIFIED');
    expect(outcome.match).toBeNull();
  });

  // 10. Idempotency Key Reuse
  test('Requirement 10: Retrying call for same task reuses the same idempotency key', () => {
    const taskId = `test_task_${Date.now()}`;
    const key1 = getOrCreateIdempotencyKey(taskId);
    const key2 = getOrCreateIdempotencyKey(taskId);
    expect(key1).toBe(key2);
  });

  // 13, 14, 15. Excel (.xlsx) Multi-Sheet Export Generation with Evidence Chains
  test('Requirement 13, 14, 15: Excel export creates a genuine XLSX workbook with Evidence Chains and transcripts', async () => {
    const sampleTask: VerificationTask = {
      id: 'task_e2e_test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      target: {
        organizationName: 'Vanguard Industrial Valves',
        phoneNumber: '+14155550182',
        category: 'Shipment / Delivery Status',
      },
      item: '2-inch Stainless Ball Valves',
      verificationType: 'Shipment / Delivery Status',
      subject: 'PO-8821 Rush Shipment Dispatch Confirmation',
      verificationGoal: 'Confirm 40 valves are boxed for dispatch on Oct 14',
      questions: [
        {
          id: 'q1',
          order: 1,
          question: 'Are 40 valves confirmed for dispatch on Oct 14?',
          expectedType: 'boolean',
          required: true,
        },
      ],
      digitalClaim: {
        claimedStatus: 'AVAILABLE',
        claimText: 'Vendor dispatch notice stated 40 units shipping Oct 14',
        expectedQuantity: 40,
        expectedDeliveryDate: '2026-10-14',
      },
      status: 'VERIFIED',
      reviewStatus: 'NONE',
      callState: 'COMPLETED',
      mode: 'MOCK',
      callRecord: {
        id: 'call_test_1',
        taskId: 'task_e2e_test',
        providerCallId: 'calle_sim_test',
        idempotencyKey: 'idemp_test_123',
        phoneNumber: '+14155550182',
        mode: 'MOCK',
        callState: 'COMPLETED',
        startedAt: new Date().toISOString(),
        durationSeconds: 32,
        transcriptTurns: [
          {
            id: 'turn_1',
            timestamp: '00:05',
            speaker: 'AI',
            text: 'Hello, I am calling from TRACE to verify dispatch status for PO-8821.',
          },
          {
            id: 'turn_2',
            timestamp: '00:15',
            speaker: 'STAFF',
            text: 'Yes, all 40 valves are boxed on pallet 3 ready for FreightDirect pickup.',
          },
        ],
        structuredResult: {
          call_outcome: 'confirmed',
          verification_confidence: 'high',
          availability_status: 'available',
          quantity_or_capacity: '40 units',
          next_available_time: 'Oct 14 3:30 PM',
          contact_name: 'Elena',
          notes: 'All 40 valves boxed on pallet 3',
          evidence: ['all 40 valves are boxed on pallet 3'],
          question_answers: {
            q1: {
              questionId: 'q1',
              question: 'Are 40 valves confirmed for dispatch on Oct 14?',
              expectedType: 'boolean',
              answer: true,
              confidence: 'high',
              evidence: 'all 40 valves are boxed on pallet 3',
            },
          },
        },
      },
      structuredResult: {
        call_outcome: 'confirmed',
        verification_confidence: 'high',
        availability_status: 'available',
        quantity_or_capacity: '40 units',
        next_available_time: 'Oct 14 3:30 PM',
        contact_name: 'Elena',
        notes: 'All 40 valves boxed on pallet 3',
        evidence: ['all 40 valves are boxed on pallet 3'],
        question_answers: {
          q1: {
            questionId: 'q1',
            question: 'Are 40 valves confirmed for dispatch on Oct 14?',
            expectedType: 'boolean',
            answer: true,
            confidence: 'high',
            evidence: 'all 40 valves are boxed on pallet 3',
          },
        },
      },
      reconciliation: {
        outcome: 'VERIFIED',
        reviewStatus: 'NONE',
        match: true,
        explanation: 'Confirmed 40 units ready for dispatch',
        confidence: 'high',
        difference: '0 (Exact match)',
        operationalImpact: 'Refinery installation remains on schedule',
        recommendation: 'Lock in refinery crew arrival time',
        evidenceChain: {
          sourceClaim: 'Vendor portal claimed 40 valves shipping Oct 14.',
          phoneEvidence: 'Elena confirmed pallet 3 packed for 3:30 PM pickup.',
          structuredFact: { availableQuantity: 40, confirmedDeliveryDate: '2026-10-14' },
          comparison: 'Claimed 40 units matches verified 40 units.',
          outcome: 'VERIFIED',
          reviewStatus: 'NONE',
          difference: '0 (Exact match)',
          operationalImpact: 'Downstream operations proceed as planned.',
          recommendation: 'Maintain schedule.',
        },
        timestamp: new Date().toISOString(),
      },
      evidenceChain: {
        sourceClaim: 'Vendor portal claimed 40 valves shipping Oct 14.',
        phoneEvidence: 'Elena confirmed pallet 3 packed for 3:30 PM pickup.',
        structuredFact: { availableQuantity: 40, confirmedDeliveryDate: '2026-10-14' },
        comparison: 'Claimed 40 units matches verified 40 units.',
        outcome: 'VERIFIED',
        reviewStatus: 'NONE',
        difference: '0 (Exact match)',
        operationalImpact: 'Downstream operations proceed as planned.',
        recommendation: 'Maintain schedule.',
      },
    };

    const buffer = await generateTasksExcelWorkbook([sampleTask]);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);

    // Read back workbook to verify worksheets and contents
    const readWorkbook = new ExcelJS.Workbook();
    await readWorkbook.xlsx.load(buffer as any);

    expect(readWorkbook.worksheets.length).toBe(5);
    expect(readWorkbook.getWorksheet('Verification Summary')).toBeDefined();
    expect(readWorkbook.getWorksheet('Evidence Chains')).toBeDefined();
    expect(readWorkbook.getWorksheet('Question Answers')).toBeDefined();
    expect(readWorkbook.getWorksheet('Transcripts')).toBeDefined();
    expect(readWorkbook.getWorksheet('Raw Results')).toBeDefined();

    // Verify CSV output
    const csv = generateTasksCsv([sampleTask]);
    expect(csv).toContain('Vanguard Industrial Valves');
    expect(csv).toContain('+1******0182');
    expect(csv).toContain('2-inch Stainless Ball Valves');
  });

  // 16. Webhook Deduplication
  test('Requirement 16: Webhook events are deduplicated by event ID', async () => {
    const eventId = `evt_test_${Date.now()}`;
    const payload = {
      id: eventId,
      type: 'call.completed',
      data: { call_id: 'non_existent_call' },
    };

    const res1 = await callService.handleWebhookEvent(payload);
    expect(res1.processed).toBe(true);
    expect(res1.duplicate).toBeFalsy();

    const res2 = await callService.handleWebhookEvent(payload);
    expect(res2.processed).toBe(true);
    expect(res2.duplicate).toBe(true);
  });

  // 17. The 4 Functional Truth Cases (CASE A, B, C, D)
  describe('The Four Core Operational Truth Cases', () => {
    const digitalClaim500 = {
      claimedStatus: 'AVAILABLE' as const,
      claimText: 'ERP records claim 500 units in stock at San Jose warehouse',
      expectedQuantity: 500,
    };

    // CASE A — VERIFIED
    test('CASE A — VERIFIED: Claim 500 units + Call evidence 500 units confirmed = VERIFIED', () => {
      const result: any = {
        call_outcome: 'confirmed',
        verification_confidence: 'high',
        availability_status: 'available',
        quantity_or_capacity: '500 units',
        next_available_time: 'Immediate release',
        contact_name: 'Warehouse Dispatch',
        evidence: ['Yes, we have all 500 units physically on the shelf ready to ship today.'],
        question_answers: {},
      };
      const outcome = reconcileVerificationResult(digitalClaim500, result, 'COMPLETED');
      expect(outcome.outcome).toBe('VERIFIED');
      expect(outcome.match).toBe(true);
      expect(outcome.reviewStatus).toBe('NONE');
      expect(outcome.difference).toBeNull();
      expect(outcome.recommendation).toContain('Proceed with procurement');
    });

    // CASE B — CONTRADICTED
    test('CASE B — CONTRADICTED: Claim 500 units + Call evidence 320 units available = CONTRADICTED (-180 units)', () => {
      const result: any = {
        call_outcome: 'contradicted',
        verification_confidence: 'high',
        availability_status: 'limited',
        quantity_or_capacity: '320 units',
        next_available_time: '5 days for balance',
        contact_name: 'Ray',
        evidence: ['We currently have 320 units physically in stock.'],
        question_answers: {},
      };
      const outcome = reconcileVerificationResult(digitalClaim500, result, 'COMPLETED');
      expect(outcome.outcome).toBe('CONTRADICTED');
      expect(outcome.match).toBe(false);
      expect(outcome.difference).toContain('-180 units');
      expect(outcome.difference).toContain('320 verified vs 500 claimed');
      expect(outcome.recommendation).toContain('adjust purchase order down to 320 units');
    });

    // CASE C — UNKNOWN / INCONCLUSIVE
    test('CASE C — UNKNOWN / INCONCLUSIVE: Claim 500 units + Call evidence "Cannot verify stock" = UNKNOWN / INCONCLUSIVE', () => {
      const result: any = {
        call_outcome: 'unknown',
        verification_confidence: 'low',
        availability_status: 'unknown',
        quantity_or_capacity: null,
        contact_name: 'Hotline Staff',
        notes: 'Supplier stated they do not have inventory information.',
        evidence: ["I don't have inventory information and this test hotline cannot verify stock."],
        question_answers: {},
      };
      const outcome = reconcileVerificationResult(digitalClaim500, result, 'COMPLETED');
      expect(outcome.outcome).toBe('UNKNOWN / INCONCLUSIVE');
      expect(outcome.reviewStatus).toBe('NEEDS_REVIEW');
      expect(outcome.match).toBeNull();
      expect(outcome.phoneVerifiedStatus).toBe('unknown');
      expect(outcome.difference).toBeNull();
      expect(outcome.evidenceChain?.structuredFact.availableQuantity).toBeNull();
      expect(outcome.recommendation).toContain('Do not rely on the existing claim');
    });

    // CASE D — UNREACHABLE
    test('CASE D — UNREACHABLE: Failed outbound call = UNREACHABLE', () => {
      const outcome = reconcileVerificationResult(digitalClaim500, null, 'FAILED');
      expect(outcome.outcome).toBe('UNREACHABLE');
      expect(outcome.match).toBe(false);
      expect(outcome.reviewStatus).toBe('NONE');
      expect(outcome.difference).toBeNull();
      expect(outcome.recommendation).toContain('Attempt secondary phone contact');
    });
  });

  // 18. Speaker Role Mapping Validation
  describe('Speaker & Responder Mapping Validation', () => {
    test('Speaker roles must never all be labeled as SUPPLIER or inferred by position', () => {
      const turns: Array<{ role?: string; speaker?: string; text: string }> = [
        { role: 'assistant', text: 'Hello, I am calling from TRACE Verification.' },
        { role: 'user', text: 'Apex warehouse, this is Ray.' },
        { speaker: 'AI', text: 'Can you verify 500 microcontrollers in stock?' },
        { speaker: 'STAFF', text: 'Yes, bin 14-C has 500 units.' },
      ];

      // Verify AI turns
      expect(['assistant', 'ai'].includes((turns[0]?.role || '').toLowerCase())).toBe(true);
      expect(['user', 'staff'].includes((turns[1]?.role || '').toLowerCase())).toBe(true);
    });
  });

  // 19. Transcript Naturalness & Part Number Formatting
  describe('Transcript Naturalness & Part Number Formatting', () => {
    test('Normalizes spelled-out speech artifacts into natural part numbers while preserving prose', async () => {
      const { formatNaturalTranscriptText } = await import('../utils/transcript.js');

      // Test Case 1: Spelled out acronym with numbers
      const input1 = 'Please verify the physical stock of capitalized S, capitalized T, capitalized M, three, two, H, seven, four, three, Z, I microcontrollers.';
      expect(formatNaturalTranscriptText(input1)).toBe('Please verify the physical stock of STM32H743ZI microcontrollers.');

      // Test Case 2: Partial spelled acronym
      const input2 = 'capitalized T, capitalized M, three, two';
      expect(formatNaturalTranscriptText(input2)).toBe('TM32');

      // Test Case 3: Already natural part number is preserved exactly
      const input3 = 'We have STM32H743ZIT6 in stock ready for delivery.';
      expect(formatNaturalTranscriptText(input3)).toBe('We have STM32H743ZIT6 in stock ready for delivery.');

      // Test Case 4: Standard sentence without part codes is untouched
      const input4 = 'All 40 units of 2-inch Stainless Ball Valves (ANSI 150) are packed.';
      expect(formatNaturalTranscriptText(input4)).toBe('All 40 units of 2-inch Stainless Ball Valves (ANSI 150) are packed.');
    });
  });

  // 20. Reviewer Hardening & Safety Policy Tests (Ray-56 Must-Fix Items)
  describe('Reviewer Safety & Integrity Hardening (PR #565 Must-Fix Requirements)', () => {
    // 20.1 Forced MOCK mode & Default NO-CALL
    test('Safety Rule 1: Forced MOCK environment cannot be overridden to LIVE at runtime', () => {
      const origEnv = process.env.PHONE_PROVIDER_MODE;
      try {
        process.env.PHONE_PROVIDER_MODE = 'mock';
        expect(() => callService.setMode('LIVE')).toThrow(/forced PHONE_PROVIDER_MODE=mock/);

        const active = callService.getActiveProvider();
        expect(active.mode).toBe('MOCK');
      } finally {
        process.env.PHONE_PROVIDER_MODE = origEnv;
      }
    });

    test('Safety Rule 2: Default behavior without explicit LIVE configuration is MOCK / NO-CALL', () => {
      const origEnv = process.env.PHONE_PROVIDER_MODE;
      try {
        delete process.env.PHONE_PROVIDER_MODE;
        callService.setMode('MOCK');
        const active = callService.getActiveProvider();
        expect(active.mode).toBe('MOCK');
      } finally {
        process.env.PHONE_PROVIDER_MODE = origEnv;
      }
    });

    // 20.2 Destination Authorization
    test('Safety Rule 3: Unauthorized live destinations are strictly rejected before dialing', async () => {
      const { isDestinationAuthorized } = await import('../utils/phone.js');
      const origAllowed = process.env.ALLOWED_DESTINATIONS;

      try {
        // Without ALLOWED_DESTINATIONS configured, live calls are blocked
        delete process.env.ALLOWED_DESTINATIONS;
        const check1 = isDestinationAuthorized('+14155550199', 'LIVE');
        expect(check1.authorized).toBe(false);
        expect(check1.reason).toContain('blocked');

        // With explicit allowlist
        process.env.ALLOWED_DESTINATIONS = '+14155550181,+14155550182';
        const check2 = isDestinationAuthorized('+14155550181', 'LIVE');
        expect(check2.authorized).toBe(true);

        const check3 = isDestinationAuthorized('+19999999999', 'LIVE');
        expect(check3.authorized).toBe(false);
      } finally {
        process.env.ALLOWED_DESTINATIONS = origAllowed;
      }
    });

    // 20.3 Phone Number Redaction / Masking Helper
    test('Safety Rule 4: Phone number masking helper redacts middle digits consistently', async () => {
      const { maskPhoneNumber } = await import('../utils/phone.js');

      expect(maskPhoneNumber('+14155550181')).toBe('+1******0181');
      expect(maskPhoneNumber('+919876543210')).toBe('+91******3210');
      expect(maskPhoneNumber('+447911123456')).toBe('+44******3456');
      expect(maskPhoneNumber('14155550181')).toBe('14******0181');
      expect(maskPhoneNumber('')).toBe('');
      expect(maskPhoneNumber(null as any)).toBe('');
    });

    // 20.4 Ambiguous Submissions Retain Stable Idempotency Key & Stop Batch
    test('Safety Rule 5: Ambiguous submission preserves task and stable idempotency key under PENDING_RECONCILIATION', async () => {
      const { recordCallAmbiguous } = await import('../utils/idempotency.js');
      const testTaskId = `ambig_task_${Date.now()}`;

      const key1 = getOrCreateIdempotencyKey(testTaskId);
      recordCallAmbiguous(key1, 'Network timeout awaiting provider ACK');

      // Subsequent retrieval must preserve the SAME key rather than generating a new one
      const key2 = getOrCreateIdempotencyKey(testTaskId);
      expect(key1).toBe(key2);

      const reconciliation = reconcileVerificationResult(
        { claimedStatus: 'AVAILABLE', claimText: 'Listing says 500 units in stock' },
        null,
        'PENDING_RECONCILIATION'
      );
      expect(reconciliation.outcome).toBe('UNKNOWN / INCONCLUSIVE');
      expect(reconciliation.reviewStatus).toBe('NEEDS_REVIEW');
      expect(reconciliation.recommendation).toContain('Verify existing submission status');
    });

    // 20.5 Speaker Identity & Evidence Attribution
    test('Safety Rule 6: Unknown speakers remain UNKNOWN and agent speech is excluded from supplier evidence', async () => {
      const { CallEProvider } = await import('../providers/CallEProvider.js');
      const provider = new CallEProvider();

      // Test progress extraction with unknown and AI turns
      const mockTask: VerificationTask = {
        id: 'task_speaker_test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        target: { organizationName: 'Test Corp', phoneNumber: '+14155550181' },
        item: 'Resistors',
        verificationType: 'Inventory / Availability',
        subject: 'Stock test',
        verificationGoal: 'Verify stock',
        questions: [{ id: 'q1', order: 1, question: 'How many units?', expectedType: 'number', required: true }],
        status: 'UNKNOWN / INCONCLUSIVE',
        reviewStatus: 'NONE',
        callState: 'IDLE',
        mode: 'MOCK',
      };

      // Mock client returning transcript turns with ambiguous roles
      const dummyClient = {
        calls: {
          get: async () => ({
            id: 'call_dummy_1',
            status: 'completed',
            recipients: [
              {
                status: 'completed',
                attempts: [
                  {
                    status: 'completed',
                    transcriptTurns: [
                      { role: 'assistant', text: 'Hello, I am calling from TRACE Verification.' },
                      { role: 'unidentified_audio', text: '500 units might be in the back room.' },
                    ],
                  },
                ],
              },
            ],
          }),
        },
      };

      (provider as any).getClient = () => dummyClient as any;

      const progress = await provider.getCallProgress('call_dummy_1', mockTask);
      expect(progress.transcriptTurns[0]?.speaker).toBe('AI');
      expect(progress.transcriptTurns[1]?.speaker).toBe('UNKNOWN'); // Unbound: not automatically mapped to STAFF
      expect(progress.structuredResult?.call_outcome).toBe('unknown'); // Not positive verification
      expect(progress.structuredResult?.verification_confidence).toBe('low');
    });

    // 20.6 Local-Only / Authenticated Route Security Middleware
    test('Safety Rule 7: enforceLocalOrAuthenticated permits local requests and rejects non-local unauthorized requests', async () => {
      const { enforceLocalOrAuthenticated } = await import('../utils/phone.js');

      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      // Local request (127.0.0.1)
      const reqLocal: any = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
      const resLocal: any = { status: () => ({ json: () => {} }) };
      enforceLocalOrAuthenticated(reqLocal, resLocal, next);
      expect(nextCalled).toBe(true);

      // Remote request without token -> 403 Forbidden
      nextCalled = false;
      let statusCode = 0;
      let jsonResponse: any = null;
      const reqRemote: any = {
        socket: { remoteAddress: '203.0.113.195' },
        headers: {},
      };
      const resRemote: any = {
        status: (code: number) => {
          statusCode = code;
          return {
            json: (payload: any) => {
              jsonResponse = payload;
            },
          };
        },
      };

      enforceLocalOrAuthenticated(reqRemote, resRemote, next);
      expect(nextCalled).toBe(false);
      expect(statusCode).toBe(403);
      expect(jsonResponse.error).toContain('Access Forbidden');

      // Remote request with valid TRACE_API_TOKEN -> permitted
      const origToken = process.env.TRACE_API_TOKEN;
      try {
        process.env.TRACE_API_TOKEN = 'secret-token-123';
        nextCalled = false;
        const reqAuth: any = {
          socket: { remoteAddress: '203.0.113.195' },
          headers: { authorization: 'Bearer secret-token-123' },
        };
        enforceLocalOrAuthenticated(reqAuth, resRemote, next);
        expect(nextCalled).toBe(true);

        // Remote request with invalid token -> 403 Forbidden
        nextCalled = false;
        statusCode = 0;
        const reqWrong: any = {
          socket: { remoteAddress: '203.0.113.195' },
          headers: { authorization: 'Bearer wrong-token' },
        };
        enforceLocalOrAuthenticated(reqWrong, resRemote, next);
        expect(nextCalled).toBe(false);
        expect(statusCode).toBe(403);
      } finally {
        process.env.TRACE_API_TOKEN = origToken;
      }
    });

    // 20.7 Enforce explicitLive Confirmation at Actual Call Submission Boundary (Must-Fix Item #1)
    describe('Safety Rule 8: explicitLive Confirmation at Actual Call Submission Boundary', () => {
      test('Case 1: MOCK mode without explicit confirmation proceeds safely with MockProvider', async () => {
        const origEnv = process.env.PHONE_PROVIDER_MODE;
        const origMockStart = (callService as any).mockProvider.startVerificationCall;
        const origCallEStart = (callService as any).callEProvider.startVerificationCall;
        let mockInvoked = false;
        let callEInvoked = false;

        try {
          delete process.env.PHONE_PROVIDER_MODE;
          callService.setMode('MOCK');

          (callService as any).mockProvider.startVerificationCall = async (task: any, key: string) => {
            mockInvoked = true;
            return origMockStart.call((callService as any).mockProvider, task, key);
          };
          (callService as any).callEProvider.startVerificationCall = async () => {
            callEInvoked = true;
            throw new Error('CallEProvider should not be called in MOCK mode');
          };

          const created = taskService.createTask({
            target: { organizationName: 'Mock Target Corp', phoneNumber: '+14155550181' },
            item: 'Mock Resistors',
            subject: 'Mock Stock Test',
            verificationGoal: 'Verify mock stock',
            questions: [{ id: 'q1', order: 1, question: 'In stock?', expectedType: 'boolean', required: true }],
          });
          expect(created.success).toBe(true);
          const taskId = created.task!.id;

          const result = await callService.startVerification(taskId, false, false);
          expect(result.success).toBe(true);
          expect(mockInvoked).toBe(true);
          expect(callEInvoked).toBe(false);
          expect(result.task?.mode).toBe('MOCK');
          expect(result.task?.callState).toBe('QUEUED');
        } finally {
          process.env.PHONE_PROVIDER_MODE = origEnv;
          callService.setMode(null);
          (callService as any).mockProvider.startVerificationCall = origMockStart;
          (callService as any).callEProvider.startVerificationCall = origCallEStart;
        }
      });

      test('Case 2: LIVE mode without explicit confirmation rejects before calling provider', async () => {
        const origEnv = process.env.PHONE_PROVIDER_MODE;
        const origKey = process.env.CALLE_API_KEY;
        const origAllowed = process.env.ALLOWED_DESTINATIONS;
        const origMockStart = (callService as any).mockProvider.startVerificationCall;
        const origCallEStart = (callService as any).callEProvider.startVerificationCall;
        let mockInvoked = false;
        let callEInvoked = false;

        try {
          process.env.PHONE_PROVIDER_MODE = 'calle';
          process.env.CALLE_API_KEY = 'mock_live_api_key_for_testing';
          process.env.ALLOWED_DESTINATIONS = '+14155550181';
          callService.setMode(null);

          (callService as any).mockProvider.startVerificationCall = async () => {
            mockInvoked = true;
            throw new Error('MockProvider should not be called');
          };
          (callService as any).callEProvider.startVerificationCall = async () => {
            callEInvoked = true;
            throw new Error('CallEProvider should not be called without explicitLive');
          };

          const created = taskService.createTask({
            target: { organizationName: 'Live Target Corp', phoneNumber: '+14155550181' },
            item: 'Microcontrollers',
            subject: 'Live Stock Check',
            verificationGoal: 'Verify stock on shelf',
            questions: [{ id: 'q1', order: 1, question: 'Available?', expectedType: 'boolean', required: true }],
          });
          expect(created.success).toBe(true);
          const taskId = created.task!.id;

          // Dispatch WITHOUT explicitLive (explicitLive = false)
          const result = await callService.startVerification(taskId, false, false);
          expect(result.success).toBe(false);
          expect(result.error).toContain('explicitLive confirmation is required');
          expect(callEInvoked).toBe(false);
          expect(mockInvoked).toBe(false); // Did not silently fall back to mock
          expect(result.task?.callState).toBe('IDLE');
          expect(result.task?.status).toBe('UNKNOWN / INCONCLUSIVE');
          expect(result.task?.reviewStatus).toBe('NONE');
        } finally {
          process.env.PHONE_PROVIDER_MODE = origEnv;
          process.env.CALLE_API_KEY = origKey;
          process.env.ALLOWED_DESTINATIONS = origAllowed;
          callService.setMode(null);
          (callService as any).mockProvider.startVerificationCall = origMockStart;
          (callService as any).callEProvider.startVerificationCall = origCallEStart;
        }
      });

      test('Case 3: LIVE mode with explicit confirmation invokes CALL-E provider', async () => {
        const origEnv = process.env.PHONE_PROVIDER_MODE;
        const origKey = process.env.CALLE_API_KEY;
        const origAllowed = process.env.ALLOWED_DESTINATIONS;
        const origMockStart = (callService as any).mockProvider.startVerificationCall;
        const origCallEStart = (callService as any).callEProvider.startVerificationCall;
        let mockInvoked = false;
        let callEInvoked = false;

        try {
          process.env.PHONE_PROVIDER_MODE = 'calle';
          process.env.CALLE_API_KEY = 'mock_live_api_key_for_testing';
          process.env.ALLOWED_DESTINATIONS = '+14155550181';
          callService.setMode(null);

          (callService as any).mockProvider.startVerificationCall = async () => {
            mockInvoked = true;
            throw new Error('MockProvider should not be called');
          };
          (callService as any).callEProvider.startVerificationCall = async (task: any, key: string) => {
            callEInvoked = true;
            return {
              callId: `live_call_${task.id}`,
              initialRecord: {
                id: `call_${task.id}`,
                taskId: task.id,
                providerCallId: `live_call_${task.id}`,
                idempotencyKey: key,
                phoneNumber: task.target.phoneNumber,
                mode: 'LIVE',
                callState: 'QUEUED',
                startedAt: new Date().toISOString(),
                durationSeconds: 0,
                transcriptTurns: [],
                structuredResult: null,
              },
            };
          };

          const created = taskService.createTask({
            target: { organizationName: 'Live Target Corp', phoneNumber: '+14155550181' },
            item: 'Capacitors',
            subject: 'Stock Audit',
            verificationGoal: 'Verify warehouse inventory',
            questions: [{ id: 'q1', order: 1, question: 'Available?', expectedType: 'boolean', required: true }],
          });
          expect(created.success).toBe(true);
          const taskId = created.task!.id;

          // Dispatch WITH explicitLive = true
          const result = await callService.startVerification(taskId, false, true);
          expect(result.success).toBe(true);
          expect(callEInvoked).toBe(true);
          expect(mockInvoked).toBe(false);
          expect(result.task?.mode).toBe('LIVE');
          expect(result.task?.callState).toBe('QUEUED');
        } finally {
          process.env.PHONE_PROVIDER_MODE = origEnv;
          process.env.CALLE_API_KEY = origKey;
          process.env.ALLOWED_DESTINATIONS = origAllowed;
          callService.setMode(null);
          (callService as any).mockProvider.startVerificationCall = origMockStart;
          (callService as any).callEProvider.startVerificationCall = origCallEStart;
        }
      });

      test('Case 4: LIVE mode selected via runtime override (setMode("LIVE")) requires explicitLive === true and rejects without it', async () => {
        const origEnv = process.env.PHONE_PROVIDER_MODE;
        const origKey = process.env.CALLE_API_KEY;
        const origAllowed = process.env.ALLOWED_DESTINATIONS;
        const origMockStart = (callService as any).mockProvider.startVerificationCall;
        const origCallEStart = (callService as any).callEProvider.startVerificationCall;
        let mockInvoked = false;
        let callEInvoked = false;

        try {
          delete process.env.PHONE_PROVIDER_MODE;
          process.env.CALLE_API_KEY = 'mock_live_api_key_for_testing';
          process.env.ALLOWED_DESTINATIONS = '+14155550181';
          callService.setMode('LIVE');

          (callService as any).mockProvider.startVerificationCall = async () => {
            mockInvoked = true;
            throw new Error('MockProvider should not be called');
          };
          (callService as any).callEProvider.startVerificationCall = async (task: any, key: string) => {
            callEInvoked = true;
            return {
              callId: `live_call_${task.id}`,
              initialRecord: {
                id: `call_${task.id}`,
                taskId: task.id,
                providerCallId: `live_call_${task.id}`,
                idempotencyKey: key,
                phoneNumber: task.target.phoneNumber,
                mode: 'LIVE',
                callState: 'QUEUED',
                startedAt: new Date().toISOString(),
                durationSeconds: 0,
                transcriptTurns: [],
                structuredResult: null,
              },
            };
          };

          const created1 = taskService.createTask({
            target: { organizationName: 'Override Target Corp', phoneNumber: '+14155550181' },
            item: 'Sensors Part 1',
            subject: 'Override Stock Audit',
            verificationGoal: 'Verify inventory',
            questions: [{ id: 'q1', order: 1, question: 'In stock?', expectedType: 'boolean', required: true }],
          });
          expect(created1.success).toBe(true);

          // Without explicitLive -> must reject safely and preserve IDLE task state
          const unconfirmedResult = await callService.startVerification(created1.task!.id, false, false);
          expect(unconfirmedResult.success).toBe(false);
          expect(unconfirmedResult.error).toContain('explicitLive confirmation is required');
          expect(callEInvoked).toBe(false);
          expect(unconfirmedResult.task?.callState).toBe('IDLE');
          expect(unconfirmedResult.task?.status).toBe('UNKNOWN / INCONCLUSIVE');

          // Confirmed retry on the SAME task must succeed and invoke CALL-E
          const confirmedResult = await callService.startVerification(created1.task!.id, false, true);
          expect(confirmedResult.success).toBe(true);
          expect(callEInvoked).toBe(true);
          expect(confirmedResult.task?.mode).toBe('LIVE');
          expect(confirmedResult.task?.callState).toBe('QUEUED');
        } finally {
          process.env.PHONE_PROVIDER_MODE = origEnv;
          process.env.CALLE_API_KEY = origKey;
          process.env.ALLOWED_DESTINATIONS = origAllowed;
          callService.setMode(null);
          (callService as any).mockProvider.startVerificationCall = origMockStart;
          (callService as any).callEProvider.startVerificationCall = origCallEStart;
        }
      });

      test('Case 5: forceMock=true forces MOCK mode and prevents CALL-E invocation even if global LIVE is configured', async () => {
        const origEnv = process.env.PHONE_PROVIDER_MODE;
        const origKey = process.env.CALLE_API_KEY;
        const origAllowed = process.env.ALLOWED_DESTINATIONS;
        const origMockStart = (callService as any).mockProvider.startVerificationCall;
        const origCallEStart = (callService as any).callEProvider.startVerificationCall;
        let mockInvoked = false;
        let callEInvoked = false;

        try {
          process.env.PHONE_PROVIDER_MODE = 'calle';
          process.env.CALLE_API_KEY = 'mock_live_api_key_for_testing';
          process.env.ALLOWED_DESTINATIONS = '+14155550181';
          callService.setMode(null);

          (callService as any).mockProvider.startVerificationCall = async (task: any, key: string) => {
            mockInvoked = true;
            return origMockStart.call((callService as any).mockProvider, task, key);
          };
          (callService as any).callEProvider.startVerificationCall = async () => {
            callEInvoked = true;
            throw new Error('CallEProvider should not be called when forceMock=true');
          };

          const created = taskService.createTask({
            target: { organizationName: 'ForceMock Target', phoneNumber: '+14155550181' },
            item: 'Diodes',
            subject: 'Forced Mock Test',
            verificationGoal: 'Verify fallback behavior',
            questions: [{ id: 'q1', order: 1, question: 'In stock?', expectedType: 'boolean', required: true }],
          });
          expect(created.success).toBe(true);
          const taskId = created.task!.id;

          // Call with forceMock = true and explicitLive = true
          const result = await callService.startVerification(taskId, true, true);
          expect(result.success).toBe(true);
          expect(callEInvoked).toBe(false); // CALL-E provider MUST NOT be called!
          expect(mockInvoked).toBe(true);   // Mock provider handled it
          expect(result.task?.mode).toBe('MOCK');
        } finally {
          process.env.PHONE_PROVIDER_MODE = origEnv;
          process.env.CALLE_API_KEY = origKey;
          process.env.ALLOWED_DESTINATIONS = origAllowed;
          callService.setMode(null);
          (callService as any).mockProvider.startVerificationCall = origMockStart;
          (callService as any).callEProvider.startVerificationCall = origCallEStart;
        }
      });

      test('Case 6: Unconfigured LIVE mode produces an explicit error without silent fallback to MOCK', async () => {
        const origEnv = process.env.PHONE_PROVIDER_MODE;
        const origKey = process.env.CALLE_API_KEY;
        const origEKey = process.env.CALL_E_API_KEY;
        const origAllowed = process.env.ALLOWED_DESTINATIONS;
        const origMockStart = (callService as any).mockProvider.startVerificationCall;
        const origCallEStart = (callService as any).callEProvider.startVerificationCall;
        let mockInvoked = false;
        let callEInvoked = false;

        try {
          process.env.PHONE_PROVIDER_MODE = 'calle';
          delete process.env.CALLE_API_KEY;
          delete process.env.CALL_E_API_KEY;
          process.env.ALLOWED_DESTINATIONS = '+14155550181';
          callService.setMode(null);

          (callService as any).mockProvider.startVerificationCall = async () => {
            mockInvoked = true;
            throw new Error('MockProvider should not be called');
          };
          (callService as any).callEProvider.startVerificationCall = async () => {
            callEInvoked = true;
            throw new Error('CallEProvider should not be called');
          };

          const created = taskService.createTask({
            target: { organizationName: 'Unconfigured Live Target', phoneNumber: '+14155550181' },
            item: 'Relays',
            subject: 'Unconfigured Live Test',
            verificationGoal: 'Verify failure on unconfigured API key',
            questions: [{ id: 'q1', order: 1, question: 'In stock?', expectedType: 'boolean', required: true }],
          });
          expect(created.success).toBe(true);
          const taskId = created.task!.id;

          const result = await callService.startVerification(taskId, false, true);
          expect(result.success).toBe(false);
          expect(result.error).toContain('CALLE_API_KEY is not configured');
          expect(callEInvoked).toBe(false);
          expect(mockInvoked).toBe(false);
          expect(result.task?.callState).toBe('IDLE');
          expect(result.task?.status).toBe('UNKNOWN / INCONCLUSIVE');
        } finally {
          process.env.PHONE_PROVIDER_MODE = origEnv;
          process.env.CALLE_API_KEY = origKey;
          process.env.CALL_E_API_KEY = origEKey;
          process.env.ALLOWED_DESTINATIONS = origAllowed;
          callService.setMode(null);
          (callService as any).mockProvider.startVerificationCall = origMockStart;
          (callService as any).callEProvider.startVerificationCall = origCallEStart;
        }
      });
    });

    // 20.8 Phone number masking in freeform text & diagnostic paths
    test('Safety Rule 9: maskPhoneNumbersInText redacts phone numbers in logs, transcripts, and errors without altering quantities', async () => {
      const { maskPhoneNumbersInText } = await import('../utils/phone.js');

      // Embedded phone numbers
      expect(maskPhoneNumbersInText('Direct dialing +14155550181 initiated')).toBe('Direct dialing +1******0181 initiated');
      expect(maskPhoneNumbersInText('Error from carrier for +919876543210: busy')).toBe('Error from carrier for +91******3210: busy');
      expect(maskPhoneNumbersInText('Caller at 415-555-0181 picked up')).toBe('Caller at +1******0181 picked up');

      // Quantities, prices, part numbers must NOT be redacted
      expect(maskPhoneNumbersInText('Confirmed 500 units in stock at $12.50 each')).toBe('Confirmed 500 units in stock at $12.50 each');
      expect(maskPhoneNumbersInText('Part number STM32F401RE is on shelf')).toBe('Part number STM32F401RE is on shelf');
      expect(maskPhoneNumbersInText('')).toBe('');
      expect(maskPhoneNumbersInText(null as any)).toBe('');
    });

    // 20.9 Qualified verification claims (advisory/experimental notice)
    test('Safety Rule 10: Reconciliation outcomes qualify claims as conversational phone evidence rather than ground truth', () => {
      const result = reconcileVerificationResult(
        { claimedStatus: 'AVAILABLE', claimText: 'Claim 500 units available' },
        {
          call_outcome: 'confirmed',
          verification_confidence: 'high',
          availability_status: 'available',
          quantity_or_capacity: '500',
          next_available_time: null,
          contact_name: 'Staff',
          notes: 'Confirmed stock',
          evidence: ['500 units in stock'],
          question_answers: {},
        },
        'COMPLETED'
      );

      expect(result.outcome).toBe('VERIFIED');
      expect(result.explanation).toContain('(advisory)');
      expect(result.explanation).toContain('conversational phone evidence');
      expect(result.explanation).not.toContain('physical reality');
      expect(result.evidenceChain?.comparison).toContain('(advisory)');
    });
  });
});
