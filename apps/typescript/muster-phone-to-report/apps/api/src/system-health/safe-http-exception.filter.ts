import { randomUUID } from "node:crypto";

import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";

import type { ClientSafeErrorCode, ClientSafeErrorResponse } from "@muster/contracts";

interface FastifyReplyLike {
  code(statusCode: number): FastifyReplyLike;
  header(name: string, value: string): FastifyReplyLike;
  send(body: ClientSafeErrorResponse): void;
}

function errorContract(status: number): {
  readonly code: ClientSafeErrorCode;
  readonly message: string;
} {
  if (status === HttpStatus.BAD_REQUEST) {
    return { code: "validation_error", message: "Request validation failed" };
  }
  if (status === HttpStatus.NOT_FOUND) return { code: "not_found", message: "Resource not found" };
  if (status === HttpStatus.CONFLICT) {
    return { code: "conflict", message: "Request conflict" };
  }
  if (status === HttpStatus.SERVICE_UNAVAILABLE) {
    return { code: "dependency_unavailable", message: "Service unavailable" };
  }
  return { code: "unexpected_error", message: "Unexpected error" };
}

@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReplyLike>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const safe = errorContract(status);
    reply
      .header("Cache-Control", "no-store, max-age=0")
      .header("Pragma", "no-cache")
      .header("Expires", "0")
      .header("X-Content-Type-Options", "nosniff")
      .code(status)
      .send({
        error: {
          code: safe.code,
          message: safe.message,
          correlationId: randomUUID(),
        },
      });
  }
}
