export type DtmfCanaryResult =
  | Readonly<{
      status: "clear";
      actionsObserved: 0;
      compatibility: "simulator-tested";
    }>
  | Readonly<{
      status: "failed";
      actionsObserved: 1;
      compatibility: "simulator-tested";
      reason: "dtmf_observed";
    }>;

export function mapDtmfCanary(
  form: Readonly<Record<string, string | undefined>>,
): DtmfCanaryResult {
  const observed = (form["Digits"] ?? "").length > 0;
  return observed
    ? Object.freeze({
        status: "failed",
        actionsObserved: 1,
        compatibility: "simulator-tested",
        reason: "dtmf_observed",
      })
    : Object.freeze({
        status: "clear",
        actionsObserved: 0,
        compatibility: "simulator-tested",
      });
}

export interface DtmfSafetyStop {
  observe(form: Readonly<Record<string, string | undefined>>): DtmfCanaryResult;
  isBlocked(): boolean;
  assertDispatchAllowed(): void;
  onBlocked?(listener: () => void): () => void;
}

export function createDtmfSafetyStop(): DtmfSafetyStop {
  let blocked = false;
  const listeners = new Set<() => void>();
  return Object.freeze({
    observe(form: Readonly<Record<string, string | undefined>>): DtmfCanaryResult {
      const result = mapDtmfCanary(form);
      if (result.status === "failed" && !blocked) {
        blocked = true;
        for (const listener of listeners) listener();
      }
      return result;
    },
    isBlocked: () => blocked,
    assertDispatchAllowed: (): void => {
      if (blocked) throw new Error("DTMF safety stop is active");
    },
    onBlocked: (listener: () => void): (() => void) => {
      if (blocked) listener();
      else listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
