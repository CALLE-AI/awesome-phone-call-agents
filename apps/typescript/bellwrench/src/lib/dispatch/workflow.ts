export interface CallApprovalState {
  dispatchId: string;
  confirmed: boolean;
  hasResponse: boolean;
}

export interface InvalidatedCallApproval {
  dispatchId: "";
  confirmed: false;
  clearResponse: boolean;
  clearPendingIntent: true;
}

export function invalidateCallApproval(
  state: CallApprovalState,
): InvalidatedCallApproval {
  return {
    dispatchId: "",
    confirmed: false,
    clearResponse: state.hasResponse,
    clearPendingIntent: true,
  };
}

export function canReturnToPrepare(isCalling: boolean): boolean {
  return !isCalling;
}
