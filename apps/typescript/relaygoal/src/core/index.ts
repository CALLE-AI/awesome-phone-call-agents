// Public surface of the reusable verified-phone-outcome core.
export * from "./types";
export { isValidE164, assertE164, maskPhone, InvalidPhoneNumberError } from "./phone";
export { verifyOutcome, type VerifyOptions } from "./verify";
export { runVerifiedGoal, type VerifiedGoalRequest } from "./runGoal";
export {
  runVerifiedBatch,
  parseComparable,
  type BatchRecipient,
  type BatchItemResult,
  type BatchOutcome,
  type RankSpec,
  type VerifiedBatchRequest,
} from "./batch";
export { FakeCalle, type FakeResolver } from "./fakecalle";
export {
  createLiveCalle,
  loadLiveCalle,
  selectCalleClient,
  toCreateInput,
  toRequestOptions,
  pickTranscript,
  mapCallToResult,
  type LoadLiveCalleOptions,
  type LiveCalleWaitOptions,
} from "./livecalle";
