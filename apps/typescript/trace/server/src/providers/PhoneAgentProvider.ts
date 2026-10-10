import { CallRecord, VerificationTask } from '../types/index.js';

export interface PhoneAgentProvider {
  /**
   * Dispatches an autonomous phone verification call to the target phone number.
   * Guaranteed to use the exact user-supplied E.164 phone number.
   */
  startVerificationCall(
    task: VerificationTask,
    idempotencyKey: string
  ): Promise<{ callId: string; initialRecord: CallRecord }>;

  /**
   * Retrieves the current progress, real transcript, and structured results of an active/completed call.
   */
  getCallProgress(callId: string, task: VerificationTask): Promise<CallRecord>;
}
