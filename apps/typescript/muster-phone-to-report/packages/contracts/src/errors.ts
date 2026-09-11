export type ClientSafeErrorCode =
  | "validation_error"
  | "not_found"
  | "conflict"
  | "access_denied"
  | "dependency_unavailable"
  | "unexpected_error";

export interface ClientSafeError {
  readonly code: ClientSafeErrorCode;
  readonly message: string;
  readonly correlationId: string;
}

export interface ClientSafeErrorResponse {
  readonly error: ClientSafeError;
}
