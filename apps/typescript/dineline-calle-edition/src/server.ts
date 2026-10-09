import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z, ZodError } from "zod";

import {
  AdapterScenarioSchema,
  N8nDispatchRequestSchema,
  serializeN8nDispatchResponse,
} from "./adapters/n8n-booking-adapter.js";
import {
  IntakeScenarioSchema,
  N8nIntakeDispatchRequestSchema,
  serializeN8nIntakeResponse,
} from "./adapters/n8n-intake-adapter.js";
import {
  BookingDraftSchema,
  createApprovedBookingContract,
  maskPhone,
  type ApprovedBookingContract,
} from "./domain/booking-contract.js";
import {
  createPreferenceIntakeContract,
  maskIntakePhone,
  PreferenceIntakeRequestSchema,
  type ApprovedPreferenceIntakeContract,
} from "./domain/dining-preferences.js";
import {
  createCorrelationId,
  createExecutionContext,
  createIntakeCorrelationId,
  createIntakeExecutionContext,
} from "./domain/execution-context.js";
import { createBookingCallProvider } from "./providers/calle/provider-factory.js";
import {
  FixtureBookingProvider,
  type FixtureScenario,
} from "./providers/calle/fixture-provider.js";
import {
  FixturePreferenceIntakeProvider,
  type FixtureIntakeScenario,
} from "./providers/calle/fixture-intake-provider.js";
import { createPreferenceIntakeProvider } from "./providers/calle/intake-provider-factory.js";
import type { PreferenceIntakeProvider } from "./providers/calle/intake-types.js";
import { hasValidAllowedPhoneNumbers } from "./providers/calle/phone-allowlist.js";
import {
  CallReconciliationRejectedError,
  type BookingCallProvider,
  type ProviderCallResult,
} from "./providers/calle/types.js";
import { redactPhoneNumbers } from "./security/phone-redaction.js";
import { BookingCallService } from "./services/booking-call-service.js";
import { FileIdempotencyStore } from "./services/idempotency-store.js";
import { PreferenceIntakeService } from "./services/preference-intake-service.js";

const MAX_JSON_BODY_BYTES = 64 * 1024;
const DEFAULT_BIND_HOST = "127.0.0.1";
const liveExecutionPaths = new Set([
  "/api/intake/execute",
  "/api/intake/reconcile",
  "/api/n8n/intake/dispatch",
  "/api/execute",
  "/api/reconcile",
  "/api/n8n/dispatch",
]);

const ExecuteRequestSchema = z
  .object({
    draft: BookingDraftSchema,
    approvedContractId: z.string().regex(/^[a-f0-9]{64}$/),
    explicitApproval: z.literal(true),
    scenario: AdapterScenarioSchema.default("confirmed"),
    sessionId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/),
  })
  .strict();

const IntakeExecuteRequestSchema = z
  .object({
    request: PreferenceIntakeRequestSchema,
    approvedRequestId: z.string().regex(/^[a-f0-9]{64}$/),
    scenario: IntakeScenarioSchema.default("complete"),
  })
  .strict();

const ReconcileRequestSchema = ExecuteRequestSchema.omit({ scenario: true });
const IntakeReconcileRequestSchema = IntakeExecuteRequestSchema.omit({
  scenario: true,
});

type UiScenario = z.infer<typeof AdapterScenarioSchema>;
type UiIntakeScenario = z.infer<typeof IntakeScenarioSchema>;

const staticAssets = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
]);

export interface DineLineServerOptions {
  projectRoot?: string;
  journalRoot?: string;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export function createDineLineServer(options: DineLineServerOptions = {}) {
  return createServer(createDineLineRequestHandler(options));
}

export function createDineLineRequestHandler(
  options: DineLineServerOptions = {},
) {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const defaultProjectRoot =
    path.basename(path.dirname(moduleDirectory)) === "dist"
      ? path.resolve(moduleDirectory, "../..")
      : path.resolve(moduleDirectory, "..");
  const projectRoot = options.projectRoot ?? defaultProjectRoot;
  const publicRoot = path.join(projectRoot, "public");
  const journalRoot = options.journalRoot ?? path.join(projectRoot, ".call-journal", "ui");
  const environment = options.environment ?? process.env;
  const bindHost = environment.HOST ?? DEFAULT_BIND_HOST;
  const now = options.now ?? (() => new Date());

  return (request: IncomingMessage, response: ServerResponse) => {
    return handleRequest(request, response, {
      publicRoot,
      journalRoot,
      environment,
      bindHost,
      now,
    });
  };
}

interface RequestContext {
  publicRoot: string;
  journalRoot: string;
  environment: NodeJS.ProcessEnv;
  bindHost: string;
  now: () => Date;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<void> {
  setSecurityHeaders(response);

  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    assertLocalOnlyLiveRoute(request.method, url.pathname, context);

    if (request.method === "GET" && url.pathname === "/api/config") {
      const mode = context.environment.DINELINE_CALL_MODE === "real" ? "real" : "fixture";
      const hasApiKey = Boolean(context.environment.CALLE_API_KEY);
      const localLiveBoundaryReady = isLoopbackHost(context.bindHost);
      const bookingCallReady =
        mode === "real" &&
        localLiveBoundaryReady &&
        context.environment.DINELINE_ALLOW_REAL_CALLS === "true" &&
        hasApiKey &&
        hasValidAllowedPhoneNumbers(
          context.environment.DINELINE_ALLOWED_BOOKING_PHONES,
        );
      const intakeCallReady =
        mode === "real" &&
        localLiveBoundaryReady &&
        context.environment.DINELINE_ALLOW_REAL_INTAKE_CALLS === "true" &&
        hasApiKey &&
        hasValidAllowedPhoneNumbers(
          context.environment.DINELINE_ALLOWED_INTAKE_PHONES,
        );
      sendJson(response, 200, {
        mode,
        realCallReady: bookingCallReady,
        bookingCallReady,
        intakeCallReady,
        agents: {
          preferenceAgent: "DineLine Concierge",
          bookingAgent: "Agent Jake",
        },
        safeguards: {
          explicitApprovalRequired: true,
          duplicateProtection: true,
          automaticRetry: false,
          evidenceVerification: true,
          destinationAllowlistRequired: true,
        },
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/intake/preview") {
      const input = PreferenceIntakeRequestSchema.parse(await readJson(request));
      const contract = createPreferenceIntakeContract(
        input,
        context.now().toISOString(),
      );
      sendJson(response, 200, {
        mode: context.environment.DINELINE_CALL_MODE === "real" ? "real" : "fixture",
        preview: serializeIntakePreview(contract),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/intake/execute") {
      const input = IntakeExecuteRequestSchema.parse(await readJson(request));
      const contract = createPreferenceIntakeContract(
        input.request,
        context.now().toISOString(),
      );
      assertApprovedIntakeRequest(contract, input.approvedRequestId);

      const provider = createUiIntakeProvider(input.scenario, context.environment);
      const store = new FileIdempotencyStore(
        path.join(context.journalRoot, "intake", input.request.sessionId),
      );
      const execution = await new PreferenceIntakeService(provider, store).execute(
        contract,
        createIntakeExecutionContext(contract.requestId),
      );

      sendJson(response, 200, {
        mode: provider.name.includes("fixture") ? "fixture" : "real",
        provider: provider.name,
        scenario: input.scenario,
        requestId: contract.requestId,
        execution,
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/intake/reconcile"
    ) {
      const input = IntakeReconcileRequestSchema.parse(await readJson(request));
      const contract = createPreferenceIntakeContract(
        input.request,
        context.now().toISOString(),
      );
      assertApprovedIntakeRequest(contract, input.approvedRequestId);

      const provider = createUiIntakeProvider("complete", context.environment);
      const store = new FileIdempotencyStore(
        path.join(context.journalRoot, "intake", input.request.sessionId),
      );
      const execution = await new PreferenceIntakeService(
        provider,
        store,
      ).reconcile(contract);

      sendJson(response, 200, {
        mode: provider.name.includes("fixture") ? "fixture" : "real",
        provider: provider.name,
        requestId: contract.requestId,
        execution,
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/n8n/intake/dispatch"
    ) {
      const input = N8nIntakeDispatchRequestSchema.parse(await readJson(request));
      const contract = createPreferenceIntakeContract(
        input.request,
        context.now().toISOString(),
      );
      assertApprovedIntakeRequest(contract, input.approvedRequestId);

      const expectedCorrelationId = createIntakeCorrelationId(contract.requestId);
      if (input.correlationId !== expectedCorrelationId) {
        throw new HttpError(
          409,
          "The intake correlation ID does not match the approved preference request.",
        );
      }

      const provider = createUiIntakeProvider(input.scenario, context.environment);
      const store = new FileIdempotencyStore(
        path.join(context.journalRoot, "n8n-intake"),
      );
      const executionContext = createIntakeExecutionContext(contract.requestId, {
        n8nExecutionId: input.source.n8nExecutionId,
        sourceCallId: input.source.sourceCallId,
        toolCallId: input.source.toolCallId,
      });
      const execution = await new PreferenceIntakeService(provider, store).execute(
        contract,
        executionContext,
      );

      response.setHeader(
        "X-DineLine-Intake-Correlation-Id",
        executionContext.correlationId,
      );
      sendJson(
        response,
        200,
        serializeN8nIntakeResponse(
          input,
          contract.requestId,
          contract.idempotencyKey,
          provider.name,
          execution,
        ),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/preview") {
      const draft = BookingDraftSchema.parse(await readJson(request));
      const contract = createApprovedBookingContract(draft, context.now().toISOString());
      sendJson(response, 200, {
        mode: context.environment.DINELINE_CALL_MODE === "real" ? "real" : "fixture",
        preview: serializeContractPreview(contract),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/execute") {
      const input = ExecuteRequestSchema.parse(await readJson(request));
      const contract = createApprovedBookingContract(
        input.draft,
        context.now().toISOString(),
      );

      if (contract.contractId !== input.approvedContractId) {
        throw new HttpError(
          409,
          "Booking details changed after approval. Review the contract again.",
        );
      }

      const provider = createUiProvider(input.scenario, context.environment);
      const store = new FileIdempotencyStore(
        uiBookingJournalDirectory(context, input.sessionId),
      );
      const execution = await new BookingCallService(provider, store).execute(
        contract,
        createExecutionContext(contract.contractId),
      );

      sendJson(response, 200, {
        mode: provider.name === "fixture" || provider.name === "timeout-fixture" ? "fixture" : "real",
        provider: provider.name,
        scenario: input.scenario,
        contractId: contract.contractId,
        execution,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reconcile") {
      const input = ReconcileRequestSchema.parse(await readJson(request));
      const contract = createApprovedBookingContract(
        input.draft,
        context.now().toISOString(),
      );
      assertApprovedContract(contract, input.approvedContractId);

      const provider = createUiProvider("confirmed", context.environment);
      const store = new FileIdempotencyStore(
        uiBookingJournalDirectory(context, input.sessionId),
      );
      const execution = await new BookingCallService(provider, store).reconcile(
        contract,
      );

      sendJson(response, 200, {
        mode:
          provider.name === "fixture" || provider.name === "timeout-fixture"
            ? "fixture"
            : "real",
        provider: provider.name,
        contractId: contract.contractId,
        execution,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/n8n/dispatch") {
      const input = N8nDispatchRequestSchema.parse(await readJson(request));
      const contract = createApprovedBookingContract(
        input.draft,
        context.now().toISOString(),
      );
      assertApprovedContract(contract, input.approvedContractId);

      const expectedCorrelationId = createCorrelationId(contract.contractId);
      if (input.correlationId !== expectedCorrelationId) {
        throw new HttpError(
          409,
          "The correlation ID does not match the approved booking fingerprint.",
        );
      }

      const provider = createUiProvider(input.scenario, context.environment);
      const store = new FileIdempotencyStore(path.join(context.journalRoot, "n8n"));
      const executionContext = createExecutionContext(contract.contractId, {
        n8nExecutionId: input.source.n8nExecutionId,
        sourceCallId: input.source.sourceCallId,
        toolCallId: input.source.toolCallId,
      });
      const execution = await new BookingCallService(provider, store).execute(
        contract,
        executionContext,
      );

      response.setHeader("X-DineLine-Correlation-Id", executionContext.correlationId);
      sendJson(
        response,
        200,
        serializeN8nDispatchResponse(input, contract, provider.name, execution),
      );
      return;
    }

    const asset = staticAssets.get(url.pathname);
    if (request.method === "GET" && asset) {
      const body = await readFile(path.join(context.publicRoot, asset.file));
      response.writeHead(200, {
        "Content-Type": asset.type,
        "Cache-Control": "no-cache",
      });
      response.end(body);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: redactPhoneNumbers(error.message) });
      return;
    }

    if (error instanceof CallReconciliationRejectedError) {
      sendJson(response, 409, { error: redactPhoneNumbers(error.message) });
      return;
    }

    if (error instanceof ZodError) {
      sendJson(response, 400, {
        error: "The request did not match the DineLine contract.",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: redactPhoneNumbers(issue.message),
        })),
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown server error";
    sendJson(response, 500, {
      error: `Request failed safely: ${redactPhoneNumbers(message)}`,
    });
  }
}

function serializeContractPreview(contract: ApprovedBookingContract) {
  return {
    contractVersion: contract.contractVersion,
    contractId: contract.contractId,
    idempotencyKey: contract.idempotencyKey,
    correlationId: createCorrelationId(contract.contractId),
    approvedAt: contract.approvedAt,
    restaurant: {
      name: redactPhoneNumbers(contract.restaurant.name),
      address: redactPhoneNumbers(contract.restaurant.address),
      phone: maskPhone(contract.restaurant.phone),
    },
    reservation: {
      ...contract.reservation,
      guestName: redactPhoneNumbers(contract.reservation.guestName),
      specialRequests: redactPhoneNumbers(contract.reservation.specialRequests),
    },
    policy: contract.policy,
  };
}

function serializeIntakePreview(contract: ApprovedPreferenceIntakeContract) {
  return {
    contractVersion: contract.contractVersion,
    requestId: contract.requestId,
    idempotencyKey: contract.idempotencyKey,
    correlationId: createIntakeCorrelationId(contract.requestId),
    requestedAt: contract.requestedAt,
    phone: maskIntakePhone(contract.phone),
    explicitConsent: contract.explicitConsent,
  };
}

function createUiProvider(
  scenario: UiScenario,
  environment: NodeJS.ProcessEnv,
): BookingCallProvider {
  const mode = environment.DINELINE_CALL_MODE ?? "fixture";

  if (mode === "fixture") {
    if (scenario === "timeout") {
      return new TimeoutFixtureProvider();
    }
    return new FixtureBookingProvider(scenario as FixtureScenario);
  }

  return createBookingCallProvider(environment);
}

function uiBookingJournalDirectory(
  context: RequestContext,
  sessionId: string,
): string {
  if ((context.environment.DINELINE_CALL_MODE ?? "fixture") === "fixture") {
    return path.join(context.journalRoot, "booking-fixture", sessionId);
  }

  // Real calls retain one global ledger so changing browser sessions cannot
  // bypass the duplicate-call guard.
  return path.join(context.journalRoot, "booking");
}

function createUiIntakeProvider(
  scenario: UiIntakeScenario,
  environment: NodeJS.ProcessEnv,
): PreferenceIntakeProvider {
  const mode = environment.DINELINE_CALL_MODE ?? "fixture";

  if (mode === "fixture") {
    if (scenario === "timeout") {
      return new TimeoutIntakeFixtureProvider();
    }
    return new FixturePreferenceIntakeProvider(
      scenario as FixtureIntakeScenario,
    );
  }

  return createPreferenceIntakeProvider(environment);
}

class TimeoutFixtureProvider implements BookingCallProvider {
  readonly name = "timeout-fixture";

  async execute(
    _contract: ApprovedBookingContract,
    _idempotencyKey: string,
    _context: ReturnType<typeof createExecutionContext>,
  ): Promise<ProviderCallResult> {
    throw new Error("Provider timed out before a reliable outcome was returned");
  }
}

class TimeoutIntakeFixtureProvider implements PreferenceIntakeProvider {
  readonly name = "timeout-intake-fixture";

  async execute(
    _contract: ApprovedPreferenceIntakeContract,
    _idempotencyKey: string,
    _context: ReturnType<typeof createIntakeExecutionContext>,
  ): Promise<ProviderCallResult> {
    throw new Error(
      "Provider timed out before a reliable preference result was returned",
    );
  }
}

function assertApprovedContract(
  contract: ApprovedBookingContract,
  approvedContractId: string,
): void {
  if (contract.contractId !== approvedContractId) {
    throw new HttpError(
      409,
      "Booking details changed after approval. Review the contract again.",
    );
  }
}

function assertApprovedIntakeRequest(
  contract: ApprovedPreferenceIntakeContract,
  approvedRequestId: string,
): void {
  if (contract.requestId !== approvedRequestId) {
    throw new HttpError(
      409,
      "The diner phone or session changed after the preference call was approved.",
    );
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new HttpError(400, "A JSON request body is required.");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function assertLocalOnlyLiveRoute(
  method: string | undefined,
  pathname: string,
  context: RequestContext,
): void {
  if (
    method === "POST" &&
    liveExecutionPaths.has(pathname) &&
    context.environment.DINELINE_CALL_MODE === "real" &&
    !isLoopbackHost(context.bindHost)
  ) {
    throw new HttpError(
      403,
      "Real CALL-E execution and reconciliation are local-only. Use a loopback HOST or fixture mode.",
    );
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");

  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    return isLoopbackHost(normalized.slice("::ffff:".length));
  }

  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? DEFAULT_BIND_HOST;
  const server = createDineLineServer();
  server.listen(port, host, () => {
    console.log(`DineLine CALL-E Edition is ready at http://${host}:${port}`);
  });
}
