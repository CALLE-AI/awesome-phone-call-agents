export interface TwilioLiveSmokeConfiguration {
  readonly voiceUrl: string;
  readonly statusCallbackUrl: string | null;
  readonly voiceMethod?: string;
  readonly statusCallbackMethod?: string;
}

const activeCallStatuses = new Set(["queued", "ringing", "in-progress"]);
const terminalCallStatuses = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);

export function createLiveSmokeRunGate(initialState: "OPEN" | "CLOSED" = "CLOSED") {
  let state = initialState;
  return Object.freeze({
    open(): void {
      state = "OPEN";
    },
    close(): void {
      state = "CLOSED";
    },
    state(): "OPEN" | "CLOSED" {
      return state;
    },
    assertOpen(): void {
      if (state !== "OPEN") throw new Error("Live-smoke run gate is closed");
    },
  });
}

export interface TwilioLiveSmokeControlTransport {
  readConfiguration(): Promise<TwilioLiveSmokeConfiguration>;
  updateConfiguration(configuration: TwilioLiveSmokeConfiguration): Promise<void>;
  listInboundCalls(input: {
    readonly startedAt: string;
    readonly endedAt: string;
  }): Promise<readonly Readonly<{ callSid: string; direction: string; status: string }>[]>;
}

type TwilioControlFetch = (
  url: string,
  init: Readonly<{
    method: "GET" | "POST";
    headers: Readonly<Record<string, string>>;
    body?: string;
    signal: AbortSignal;
  }>,
) => Promise<Readonly<{ ok: boolean; json(): Promise<unknown> }>>;

function twilioRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Twilio control response is invalid");
  }
  return value as Record<string, unknown>;
}

/** Fixed-origin, read/update-only transport for the owned synthetic Twilio number. */
export function createTwilioLiveSmokeControlTransport(input: {
  readonly accountSid: string;
  readonly numberSid: string;
  readonly authToken: string;
  readonly fetch?: TwilioControlFetch;
}): TwilioLiveSmokeControlTransport {
  if (
    !/^AC[0-9a-f]{32}$/iu.test(input.accountSid) ||
    !/^PN[0-9a-f]{32}$/iu.test(input.numberSid) ||
    input.authToken.length === 0
  ) {
    throw new Error("Twilio control configuration is invalid");
  }
  const request = input.fetch ?? (fetch as TwilioControlFetch);
  const account = encodeURIComponent(input.accountSid);
  const number = encodeURIComponent(input.numberSid);
  const baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${account}`;
  const numberUrl = `${baseUrl}/IncomingPhoneNumbers/${number}.json`;
  const authorization = `Basic ${Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64")}`;
  const invoke = async (url: string, init: Omit<Parameters<TwilioControlFetch>[1], "signal">) => {
    const response = await request(url, {
      ...init,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Twilio control request failed");
    return await response.json();
  };
  return Object.freeze({
    async readConfiguration(): Promise<TwilioLiveSmokeConfiguration> {
      const value = twilioRecord(
        await invoke(numberUrl, { method: "GET", headers: { authorization } }),
      );
      const voiceUrl = value["voice_url"];
      const statusCallback = value["status_callback"];
      if (
        typeof voiceUrl !== "string" ||
        (statusCallback !== null && statusCallback !== "" && typeof statusCallback !== "string")
      ) {
        throw new Error("Twilio control response is invalid");
      }
      return Object.freeze({
        voiceUrl,
        statusCallbackUrl:
          typeof statusCallback === "string" && statusCallback.length > 0 ? statusCallback : null,
        ...(typeof value["voice_method"] === "string"
          ? { voiceMethod: value["voice_method"] }
          : {}),
        ...(typeof value["status_callback_method"] === "string"
          ? { statusCallbackMethod: value["status_callback_method"] }
          : {}),
      });
    },
    async updateConfiguration(configuration: TwilioLiveSmokeConfiguration): Promise<void> {
      const body = new URLSearchParams({
        VoiceUrl: configuration.voiceUrl,
        VoiceMethod: "POST",
        StatusCallback: configuration.statusCallbackUrl ?? "",
        StatusCallbackMethod: "POST",
      }).toString();
      await invoke(numberUrl, {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      });
    },
    async listInboundCalls(window: {
      readonly startedAt: string;
      readonly endedAt: string;
    }): Promise<readonly Readonly<{ callSid: string; direction: string; status: string }>[]> {
      const startedAt = Date.parse(window.startedAt);
      const endedAt = Date.parse(window.endedAt);
      if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
        throw new Error("Twilio call window is invalid");
      }
      const startDate = new Date(startedAt).toISOString().slice(0, 10);
      const end = new Date(endedAt);
      const endDateExclusive = new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1),
      )
        .toISOString()
        .slice(0, 10);
      const query = new URLSearchParams({
        StartTimeAfter: startDate,
        StartTimeBefore: endDateExclusive,
      });
      const value = twilioRecord(
        await invoke(`${baseUrl}/Calls.json?${query.toString()}`, {
          method: "GET",
          headers: { authorization },
        }),
      );
      if (!Array.isArray(value["calls"])) throw new Error("Twilio control response is invalid");
      return Object.freeze(
        value["calls"]
          .map((candidate) => {
            const call = twilioRecord(candidate);
            const callStartedAt = Date.parse(String(call["start_time"]));
            if (
              typeof call["sid"] !== "string" ||
              typeof call["direction"] !== "string" ||
              typeof call["status"] !== "string" ||
              !Number.isFinite(callStartedAt) ||
              (!activeCallStatuses.has(call["status"]) && !terminalCallStatuses.has(call["status"]))
            ) {
              throw new Error("Twilio control response is invalid");
            }
            return Object.freeze({
              callSid: call["sid"],
              direction: call["direction"],
              status: call["status"],
              callStartedAt,
            });
          })
          .filter((call) => call.callStartedAt >= startedAt && call.callStartedAt <= endedAt)
          .map(({ callSid, direction, status }) => Object.freeze({ callSid, direction, status })),
      );
    },
  });
}

export function createTwilioLiveSmokeControl(input: {
  readonly transport: TwilioLiveSmokeControlTransport;
  readonly digestProviderCall: (providerCallIdentifier: string) => string;
  readonly restingConfiguration: TwilioLiveSmokeConfiguration;
  readonly liveConfiguration: TwilioLiveSmokeConfiguration;
  readonly now?: () => string;
  readonly wait?: (milliseconds: number) => Promise<void>;
}) {
  const now = input.now ?? (() => new Date().toISOString());
  const wait =
    input.wait ??
    (async (milliseconds: number) =>
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  return Object.freeze({
    async arm(): Promise<"armed" | "blocked"> {
      await input.transport.updateConfiguration(input.liveConfiguration);
      const readBack = await input.transport.readConfiguration();
      return readBack.voiceUrl === input.liveConfiguration.voiceUrl &&
        readBack.statusCallbackUrl === input.liveConfiguration.statusCallbackUrl
        ? "armed"
        : "blocked";
    },
    async restore(): Promise<"restored" | "blocked"> {
      await input.transport.updateConfiguration(input.restingConfiguration);
      const readBack = await input.transport.readConfiguration();
      return readBack.voiceUrl === input.restingConfiguration.voiceUrl &&
        readBack.statusCallbackUrl === input.restingConfiguration.statusCallbackUrl
        ? "restored"
        : "blocked";
    },
    async readConfigurationState(): Promise<"resting" | "live" | "ambiguous"> {
      const current = await input.transport.readConfiguration();
      if (
        current.voiceUrl === input.restingConfiguration.voiceUrl &&
        current.statusCallbackUrl === input.restingConfiguration.statusCallbackUrl
      ) {
        return "resting";
      }
      if (
        current.voiceUrl === input.liveConfiguration.voiceUrl &&
        current.statusCallbackUrl === input.liveConfiguration.statusCallbackUrl
      ) {
        return "live";
      }
      return "ambiguous";
    },
    async reconcile(window: {
      readonly startedAt: string;
      readonly endedAt: string;
      readonly boundCallDigest: string;
    }) {
      const inbound = (await input.transport.listInboundCalls(window)).filter(
        (call) => call.direction === "inbound",
      );
      const matching = inbound.filter(
        (call) => input.digestProviderCall(call.callSid) === window.boundCallDigest,
      );
      const outcome =
        inbound.length === 1 && matching.length === 1
          ? "one_matching_call"
          : inbound.length === 0
            ? "zero_calls"
            : matching.length === 0
              ? "mismatched_call"
              : "multiple_calls";
      return Object.freeze({
        outcome,
        inboundCallCount: inbound.length,
        matchingCallCount: matching.length,
        summary: matching.length === 1 ? "1 matching call" : `${matching.length} matching calls`,
      });
    },
    async observeExactCall(window: {
      readonly startedAt: string;
      readonly endedAt: string;
      readonly boundCallDigest: string;
    }): Promise<
      | Readonly<{ outcome: "zero_calls" }>
      | Readonly<{ outcome: "call_mismatch" }>
      | Readonly<{ outcome: "multiple_calls" }>
      | Readonly<{
          outcome: "exact_active";
          status: "queued" | "ringing" | "in-progress";
        }>
      | Readonly<{
          outcome: "exact_terminal";
          status: "completed" | "busy" | "failed" | "no-answer" | "canceled";
        }>
      | Readonly<{ outcome: "unsupported_status" }>
    > {
      const startedAt = Date.parse(window.startedAt);
      const endedAt = Date.parse(window.endedAt);
      if (
        !Number.isFinite(startedAt) ||
        !Number.isFinite(endedAt) ||
        endedAt < startedAt ||
        !/^[0-9a-f]{64}$/u.test(window.boundCallDigest)
      ) {
        return Object.freeze({ outcome: "unsupported_status" as const });
      }
      const inbound = (await input.transport.listInboundCalls(window)).filter(
        (call) => call.direction === "inbound",
      );
      if (inbound.length === 0) return Object.freeze({ outcome: "zero_calls" as const });
      if (inbound.length !== 1) return Object.freeze({ outcome: "multiple_calls" as const });
      let exact: (typeof inbound)[number] | undefined;
      try {
        exact = inbound.find(
          (call) => input.digestProviderCall(call.callSid) === window.boundCallDigest,
        );
      } catch {
        return Object.freeze({ outcome: "call_mismatch" as const });
      }
      if (exact === undefined) return Object.freeze({ outcome: "call_mismatch" as const });
      if (activeCallStatuses.has(exact.status)) {
        return Object.freeze({
          outcome: "exact_active" as const,
          status: exact.status as "queued" | "ringing" | "in-progress",
        });
      }
      if (terminalCallStatuses.has(exact.status)) {
        return Object.freeze({
          outcome: "exact_terminal" as const,
          status: exact.status as "completed" | "busy" | "failed" | "no-answer" | "canceled",
        });
      }
      return Object.freeze({ outcome: "unsupported_status" as const });
    },
    async awaitQuiescence(window: {
      readonly startedAt: string;
      readonly boundCallDigest: string;
      readonly timeoutMs: number;
      readonly trailingCallbackGraceMs: number;
      readonly requireInboundCall?: boolean;
    }): Promise<"quiescent" | "blocked"> {
      if (
        !Number.isSafeInteger(window.timeoutMs) ||
        window.timeoutMs < 1 ||
        window.timeoutMs > 120_000 ||
        !Number.isSafeInteger(window.trailingCallbackGraceMs) ||
        window.trailingCallbackGraceMs < 0 ||
        window.trailingCallbackGraceMs > 10_000 ||
        window.trailingCallbackGraceMs > window.timeoutMs ||
        !/^[0-9a-f]{64}$/u.test(window.boundCallDigest) ||
        !Number.isFinite(Date.parse(window.startedAt))
      ) {
        return "blocked";
      }
      const waitingStartedAt = Date.parse(now());
      if (!Number.isFinite(waitingStartedAt)) return "blocked";
      // One immutable budget covers arrival, provider I/O, polling backoff, and terminal grace.
      const deadlineAt = waitingStartedAt + window.timeoutMs;
      let previousObservedAt = waitingStartedAt;
      let positiveWaitScheduled = false;
      let nextPollMs = 250;
      let arrived = false;
      let activeStatus: string | undefined;
      let terminalStatus: string | undefined;
      let graceUntilAt: number | undefined;

      const scheduleNextObservation = async (
        observedAt: number,
        boundaryAt: number = deadlineAt,
      ): Promise<boolean> => {
        const delay = Math.min(nextPollMs, boundaryAt - observedAt, deadlineAt - observedAt);
        if (!Number.isFinite(delay) || delay <= 0) return false;
        await wait(delay);
        positiveWaitScheduled = true;
        nextPollMs = Math.min(nextPollMs * 2, 2_000);
        return true;
      };

      while (true) {
        const endedAt = now();
        const observationStartedAt = Date.parse(endedAt);
        if (
          !Number.isFinite(observationStartedAt) ||
          observationStartedAt < Date.parse(window.startedAt) ||
          observationStartedAt < previousObservedAt ||
          (positiveWaitScheduled && observationStartedAt === previousObservedAt) ||
          observationStartedAt > deadlineAt
        ) {
          return "blocked";
        }
        previousObservedAt = observationStartedAt;
        positiveWaitScheduled = false;

        let inbound: readonly Readonly<{
          callSid: string;
          direction: string;
          status: string;
        }>[];
        try {
          inbound = (
            await input.transport.listInboundCalls({
              startedAt: window.startedAt,
              endedAt,
            })
          ).filter((call) => call.direction === "inbound");
        } catch {
          return "blocked";
        }

        // A provider read that began in time cannot certify safety after the deadline has elapsed.
        const observedAt = Date.parse(now());
        if (
          !Number.isFinite(observedAt) ||
          observedAt < Date.parse(window.startedAt) ||
          observedAt < previousObservedAt ||
          observedAt > deadlineAt
        ) {
          return "blocked";
        }
        previousObservedAt = observedAt;

        if (inbound.length === 0) {
          if (arrived) return "blocked";
          if (window.requireInboundCall !== true) return "quiescent";
          if (observedAt >= deadlineAt) return "blocked";
          if (!(await scheduleNextObservation(observedAt))) return "blocked";
          continue;
        }
        if (inbound.length !== 1) return "blocked";

        let exactCall: (typeof inbound)[number] | undefined;
        try {
          exactCall = inbound.find(
            (call) => input.digestProviderCall(call.callSid) === window.boundCallDigest,
          );
        } catch {
          return "blocked";
        }
        if (exactCall === undefined) return "blocked";

        if (activeCallStatuses.has(exactCall.status)) {
          if (terminalStatus !== undefined) return "blocked";
          const progressed = !arrived || activeStatus !== exactCall.status;
          arrived = true;
          activeStatus = exactCall.status;
          if (progressed) nextPollMs = 250;
          if (observedAt >= deadlineAt) return "blocked";
          if (!(await scheduleNextObservation(observedAt))) return "blocked";
          continue;
        }
        if (!terminalCallStatuses.has(exactCall.status)) return "blocked";

        arrived = true;
        if (terminalStatus === undefined) {
          terminalStatus = exactCall.status;
          graceUntilAt = observedAt + window.trailingCallbackGraceMs;
          if (graceUntilAt > deadlineAt || observedAt >= deadlineAt) return "blocked";
          nextPollMs = 250;
          if (graceUntilAt === observedAt) continue;
          if (!(await scheduleNextObservation(observedAt, graceUntilAt))) return "blocked";
          continue;
        }
        if (exactCall.status !== terminalStatus || graceUntilAt === undefined) return "blocked";
        if (observedAt >= graceUntilAt) return "quiescent";
        if (observedAt >= deadlineAt) return "blocked";
        if (!(await scheduleNextObservation(observedAt, graceUntilAt))) return "blocked";
      }
    },
  });
}

export type LiveSmokePreRestorationBarrierDecision =
  | Readonly<{
      outcome: "ready";
      proof: "zero_dispatch" | "exact_call_quiescent";
    }>
  | Readonly<{
      outcome: "blocked";
      reason:
        | "operation_unavailable"
        | "owner_conflict"
        | "dispatch_ambiguous"
        | "identity_deadline"
        | "arrival_deadline"
        | "call_mismatch"
        | "multiple_calls"
        | "call_disappeared"
        | "unsupported_status"
        | "status_regressed"
        | "time_invalid"
        | "deadline_exhausted"
        | "observation_failed"
        | "configuration_ambiguous";
    }>;

export function createLiveSmokeCleanup(input: {
  readonly closeRunGate: () => void;
  readonly awaitPreRestorationBarrier: () => Promise<LiveSmokePreRestorationBarrierDecision>;
  readonly restoreTwilio: () => Promise<unknown>;
  readonly verifyTwilioResting: () => Promise<boolean>;
  readonly clearRuntimeSecrets: () => void;
  readonly stopHost: () => Promise<unknown>;
  readonly stopTunnel: () => Promise<unknown>;
  readonly teardownPersistence?: () => Promise<unknown>;
}) {
  let execution:
    | Promise<
        | Readonly<{ outcome: "restored"; hostAndTunnelMustRemainUp: false }>
        | Readonly<{ outcome: "blocked"; hostAndTunnelMustRemainUp: true }>
        | Readonly<{
            outcome: "manual_stop_required";
            hostAndTunnelMustRemainUp: false;
            hostStopped: true;
            tunnelStopRequired: true;
          }>
      >
    | undefined;
  return Object.freeze({
    execute(): Promise<
      | Readonly<{ outcome: "restored"; hostAndTunnelMustRemainUp: false }>
      | Readonly<{ outcome: "blocked"; hostAndTunnelMustRemainUp: true }>
      | Readonly<{
          outcome: "manual_stop_required";
          hostAndTunnelMustRemainUp: false;
          hostStopped: true;
          tunnelStopRequired: true;
        }>
    > {
      // Sharing the terminal promise prevents concurrent or repeated cleanup from replaying effects.
      execution ??= (async () => {
        input.closeRunGate();
        try {
          const barrier = await input.awaitPreRestorationBarrier();
          if (
            barrier.outcome !== "ready" ||
            (barrier.proof !== "zero_dispatch" && barrier.proof !== "exact_call_quiescent")
          ) {
            return Object.freeze({ outcome: "blocked" as const, hostAndTunnelMustRemainUp: true });
          }
          await input.restoreTwilio();
          if (!(await input.verifyTwilioResting())) {
            return Object.freeze({ outcome: "blocked" as const, hostAndTunnelMustRemainUp: true });
          }
        } catch {
          return Object.freeze({ outcome: "blocked" as const, hostAndTunnelMustRemainUp: true });
        }
        input.clearRuntimeSecrets();
        await input.stopHost();
        if ((await input.stopTunnel()) === "manual_stop_required") {
          return Object.freeze({
            outcome: "manual_stop_required" as const,
            hostAndTunnelMustRemainUp: false,
            hostStopped: true,
            tunnelStopRequired: true,
          });
        }
        await input.teardownPersistence?.();
        return Object.freeze({ outcome: "restored" as const, hostAndTunnelMustRemainUp: false });
      })();
      return execution;
    },
  });
}
