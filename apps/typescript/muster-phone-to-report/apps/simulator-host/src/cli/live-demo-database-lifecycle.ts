import {
  createLiveDemoDatabasePaths,
  createLiveDemoDatabasePowerShellActivation,
  LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
} from "./live-demo-database-contract.js";
import {
  assertLiveDemoDatabaseLifecycleTransition,
  createInitialLiveDemoDatabaseLifecycleState,
  parseLiveDemoDatabaseLifecycleState,
  serializeLiveDemoDatabaseLifecycleState,
  transitionLiveDemoDatabaseLifecycleState,
  type LiveDemoDatabaseLifecycleState,
  type LiveDemoDatabaseContainerOwnershipIntent,
} from "./live-demo-database-state.js";

export interface LiveDemoDatabaseStatePublication {
  createExclusive(serializedState: string): Promise<boolean>;
  replaceAtomically(
    input: Readonly<{
      expectedSerializedState: string;
      nextSerializedState: string;
    }>,
  ): Promise<boolean>;
}

export interface LiveDemoDatabaseArtifactPublication<TStaged extends object = object> {
  stage(artifacts: readonly Readonly<{ path: string; contents: string }>[]): Promise<TStaged>;
  setOwnerOnlyPermissions(staged: TStaged): Promise<void>;
  verifyOwnerOnlyPermissions(staged: TStaged): Promise<boolean>;
  publishAtomically(staged: TStaged): Promise<void>;
  discard(staged: TStaged): Promise<void>;
}

export type LiveDemoDatabasePublicationResult =
  | Readonly<{
      outcome: "started" | "transitioned" | "published";
      state: LiveDemoDatabaseLifecycleState;
    }>
  | Readonly<{ outcome: "blocked" | "cleanup_required"; message: string }>;

const blockedResult = (): Readonly<{ outcome: "blocked"; message: string }> =>
  Object.freeze({ outcome: "blocked", message: LIVE_DEMO_DATABASE_ATTENTION_MESSAGE });

export async function beginLiveDemoDatabaseLifecycle(
  input: Readonly<{
    sessionId: string;
    createdAt: string;
    containerIntent: LiveDemoDatabaseContainerOwnershipIntent;
    statePublication: LiveDemoDatabaseStatePublication;
  }>,
): Promise<LiveDemoDatabasePublicationResult> {
  const state = createInitialLiveDemoDatabaseLifecycleState(input);
  try {
    if (
      !(await input.statePublication.createExclusive(
        serializeLiveDemoDatabaseLifecycleState(state),
      ))
    ) {
      return blockedResult();
    }
  } catch {
    return blockedResult();
  }
  return Object.freeze({ outcome: "started" as const, state });
}

export async function persistLiveDemoDatabaseLifecycleTransition(
  input: Readonly<{
    current: unknown;
    next: unknown;
    statePublication: LiveDemoDatabaseStatePublication;
  }>,
): Promise<LiveDemoDatabasePublicationResult> {
  const { current, next } = assertLiveDemoDatabaseLifecycleTransition(input.current, input.next);
  try {
    const replaced = await input.statePublication.replaceAtomically({
      expectedSerializedState: serializeLiveDemoDatabaseLifecycleState(current),
      nextSerializedState: serializeLiveDemoDatabaseLifecycleState(next),
    });
    if (!replaced) return blockedResult();
  } catch {
    return blockedResult();
  }
  return Object.freeze({ outcome: "transitioned" as const, state: next });
}

async function retainCleanupRequired(
  input: Readonly<{
    current: LiveDemoDatabaseLifecycleState;
    statePublication: LiveDemoDatabaseStatePublication;
  }>,
): Promise<
  | Readonly<{ outcome: "cleanup_required"; message: string }>
  | Readonly<{ outcome: "blocked"; message: string }>
> {
  const cleanupRequired = transitionLiveDemoDatabaseLifecycleState(input.current, {
    status: "cleanup_required",
    checkpoint: input.current.checkpoint,
  });
  const retained = await persistLiveDemoDatabaseLifecycleTransition({
    current: input.current,
    next: cleanupRequired,
    statePublication: input.statePublication,
  });
  if (retained.outcome !== "transitioned") return blockedResult();
  return Object.freeze({
    outcome: "cleanup_required" as const,
    message: LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
  });
}

export async function publishLiveDemoDatabaseArtifacts<TStaged extends object>(
  input: Readonly<{
    repositoryRoot: string;
    current: unknown;
    databaseUrl: string;
    provisioningAttestationJson: string;
    statePublication: LiveDemoDatabaseStatePublication;
    artifactPublication: LiveDemoDatabaseArtifactPublication<TStaged>;
    beforeReadyTransition?: () => Promise<boolean>;
  }>,
): Promise<LiveDemoDatabasePublicationResult> {
  const current = parseLiveDemoDatabaseLifecycleState(input.current);
  const ready = transitionLiveDemoDatabaseLifecycleState(current, {
    status: "ready",
    checkpoint: "artifacts_published",
  });
  const paths = createLiveDemoDatabasePaths(input.repositoryRoot);
  const activation = createLiveDemoDatabasePowerShellActivation({
    databaseUrl: input.databaseUrl,
    attestationFilePath: paths.provisioningAttestation,
  });
  let staged: TStaged | undefined;
  try {
    staged = await input.artifactPublication.stage(
      Object.freeze([
        Object.freeze({ path: paths.databaseUrl, contents: `${input.databaseUrl}\n` }),
        Object.freeze({
          path: paths.provisioningAttestation,
          contents: `${input.provisioningAttestationJson}\n`,
        }),
        Object.freeze({ path: paths.activationScript, contents: activation }),
      ]),
    );
    await input.artifactPublication.setOwnerOnlyPermissions(staged);
    if (!(await input.artifactPublication.verifyOwnerOnlyPermissions(staged))) {
      throw new Error("protected permissions unavailable");
    }
    await input.artifactPublication.publishAtomically(staged);
    if (input.beforeReadyTransition !== undefined && !(await input.beforeReadyTransition())) {
      throw new Error("protected recovery cleanup unavailable");
    }
  } catch {
    if (staged !== undefined) {
      try {
        await input.artifactPublication.discard(staged);
      } catch {
        // The fixed recovery record remains authoritative when staging cleanup is uncertain.
      }
    }
    return await retainCleanupRequired({ current, statePublication: input.statePublication });
  }
  const transitioned = await persistLiveDemoDatabaseLifecycleTransition({
    current,
    next: ready,
    statePublication: input.statePublication,
  });
  if (transitioned.outcome !== "transitioned") return blockedResult();
  return Object.freeze({ outcome: "published" as const, state: transitioned.state });
}

export { LIVE_DEMO_DATABASE_ATTENTION_MESSAGE };
