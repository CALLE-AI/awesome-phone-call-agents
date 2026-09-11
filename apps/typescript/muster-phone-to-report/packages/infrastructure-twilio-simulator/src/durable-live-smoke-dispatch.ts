export interface DurableLiveSmokeDispatchRepository {
  claim(input: {
    readonly operationId: string;
  }): Promise<Readonly<{ outcome: "claimed" }> | Readonly<{ outcome: "reconcile" }>>;
  recordDisposition(input: {
    readonly operationId: string;
    readonly outcome: "provider_returned" | "provider_failed";
  }): Promise<void>;
}

export class DurableLiveSmokeDispatchPersistenceError extends Error {
  public readonly reason = "application_persistence_failed" as const;

  public constructor() {
    super("Live smoke dispatch persistence failed");
    this.name = "DurableLiveSmokeDispatchPersistenceError";
  }
}

/**
 * Crosses the provider-create boundary only for the durable transition winner.
 * A process restart can only reconcile the already-claimed operation.
 */
export function createDurableLiveSmokeDispatch<T>(input: {
  readonly repository: DurableLiveSmokeDispatchRepository;
  readonly create: (request: { readonly operationId: string }) => Promise<T>;
  readonly reconcile: (request: { readonly operationId: string }) => Promise<T>;
}) {
  return Object.freeze({
    async execute(request: { readonly operationId: string }): Promise<T> {
      const claim = await input.repository.claim(request);
      if (claim.outcome === "reconcile") return await input.reconcile(request);
      let result: T;
      try {
        result = await input.create(request);
      } catch (error: unknown) {
        try {
          await input.repository.recordDisposition({
            operationId: request.operationId,
            outcome: "provider_failed",
          });
        } catch {
          // Preserve the provider transport failure; disposition persistence is a separate seam.
        }
        throw error;
      }
      try {
        await input.repository.recordDisposition({
          operationId: request.operationId,
          outcome: "provider_returned",
        });
      } catch {
        throw new DurableLiveSmokeDispatchPersistenceError();
      }
      return result;
    },
  });
}
