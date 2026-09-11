"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { authClient } from "@/auth-client";
import { BrandMark } from "@/components/brand-mark";
import { useWorkspaceConfiguration } from "@/components/workspace-configuration";
import { projectConfig } from "@/config/project";

import {
  createNewCaseWorkOrderReference,
  NewCaseForm,
  PRESET_DEMO_WORK_ORDER,
  type NewCaseFieldErrors,
  type NewCaseInput,
} from "./new-case-form";
import { SignInScreen } from "./sign-in-screen";

type Workspace = {
  id: string;
  slug: string;
  displayName: string;
  kind: "demo" | "protected";
  provider: "fake" | "call_e";
  liveCallsAllowed: boolean;
  role: "owner" | "operator" | "auditor";
};

type HumanDispositionOutcome =
  | "closeout_accepted"
  | "return_visit_handoff"
  | "manual_follow_up_handoff"
  | "no_further_automated_action";

type CaseSummary = {
  id: string;
  version: number;
  status: string;
  workOrderRef: string;
  contractorDisplayName: string;
  siteLabel: string;
  timezone: string;
  contactRole: string;
  phoneMasked: string;
  currentAttemptId: string | null;
  providerTaskStatus: string | null;
  attemptOutcome: string | null;
  creationDisposition: string | null;
  createdAt: string;
  updatedAt: string;
};

type CaseDetail = {
  case: {
    id: string;
    version: number;
    status: string;
    workOrderRef: string;
    contractorDisplayName: string;
    siteLabel: string;
    timezone: string;
    requestedFields: string[];
    visitContext: {
      serviceDate: string;
      equipmentLabel: string;
      technicianCompletionNote: string;
      allowedReferenceText: string;
    };
    currentAttemptId: string | null;
    contact: {
      displayName: string | null;
      role: string;
      phoneMasked: string;
      authorizationBasis: string;
      authorizationNote: string;
      doNotCallAt: string | null;
    };
  };
  attempt: {
    id: string;
    mode: string;
    provider: string;
    providerCallId: string | null;
    providerTaskStatus: string;
    attemptOutcome: string;
    creationDisposition: string;
    errorCode: string | null;
    requestedAt: string | null;
    acceptedAt: string | null;
    approval: {
      approvedAt: string;
      approvedBy: string;
      liveCallApproved: boolean;
      operatorAttestations: string[];
    } | null;
  } | null;
  result: {
    id: string;
    providerTaskStatus: string;
    contactVerification: string;
    observedOperatingStatus: string;
    unresolvedIssue: AnswerValue;
    returnVisitRequested: AnswerValue;
    preferredWindows: Array<{
      startLocal: string;
      endLocal: string;
      timezone: string;
      status: string;
    }>;
    outOfScopeTopics: string[];
    escalationReasons: string[];
    summary: string;
    route: string;
    normalizedAt: string;
  } | null;
  tasks: Array<{
    id: string;
    type: string;
    reasonCodes: string[];
    status: string;
    assignedTo: string | null;
    createdAt: string;
    resolvedAt: string | null;
    resolutionNote: string | null;
  }>;
  disposition: {
    id: string;
    taskId: string;
    outcome: HumanDispositionOutcome;
    resolutionNote: string | null;
    recordedBy: string;
    recordedAt: string;
  } | null;
  audit: Array<{
    id: string;
    actorType: string;
    actorId: string | null;
    eventType: string;
    occurredAt: string;
    metadata: Record<string, string | number | boolean | null>;
  }>;
};

type AnswerValue = {
  value: string;
  confidence: string;
  evidenceRefs: string[];
  note?: string;
};

type CallPreview = {
  caseId: string;
  caseVersion: number;
  mode: "fake" | "live";
  provider: "fake" | "call_e";
  briefHash: string;
  requiredAttestations?: string[];
  brief: {
    contractorDisplayName: string;
    workOrderRef: string;
    recipient: {
      nameOrRole: string;
      phoneMasked: string;
      timezone: string;
    };
    disclosure: string;
    objective: string;
    allowedReferenceText: string;
    questions: string[];
    prohibitedActions: string[];
    voicemailPolicy: string;
    maxBoundedClarificationsPerQuestion: number;
  };
};

type ViewName = "cases" | "exceptions" | "audit";
type DetailLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "not_found"
  | "access_denied"
  | "error";
type WorkspaceLoadState = "loading" | "ready" | "unavailable";

export type WorkspaceRoute = {
  workspaceSlug?: string;
  view: ViewName;
  caseId?: string;
  newCase?: boolean;
};

const scenarioOptions = [
  ["resolved_clear", "Clear closeout", "Operating normally; no issue reported"],
  [
    "issue_return_requested",
    "Return visit requested",
    "Issue remains; human scheduling review",
  ],
  [
    "ambiguous_after_clarification",
    "Ambiguous answer",
    "Uncertainty preserved after one clarification",
  ],
  ["wrong_person", "Wrong person", "No case details discussed"],
  ["do_not_call", "Do not call", "Durable automated-call block"],
  ["no_answer", "No answer", "Unreachable; no voicemail left"],
  [
    "technical_advice_requested",
    "Technical request",
    "Agent declines and routes to a human",
  ],
  [
    "commercial_commitment_requested",
    "Commercial request",
    "No pricing or timing commitment",
  ],
  [
    "malformed_provider_result",
    "Malformed result",
    "Schema failure routes to human review",
  ],
  [
    "creation_timeout_unknown",
    "Creation timeout",
    "Retry freezes pending reconciliation",
  ],
] as const;

const fakeApprovalAttestations = [
  ["contact_authorized", "This fictional contact is authorized for the demo."],
  ["brief_reviewed", "I reviewed the exact purpose and questions."],
  ["fictional_demo_only", "I understand no real phone call will be placed."],
] as const;

const liveApprovalAttestations = [
  [
    "contact_authorized",
    "This contact and closeout purpose are authorized by my organization.",
  ],
  ["brief_reviewed", "I reviewed the exact recipient, purpose, and questions."],
  [
    "live_call_authorized",
    "I authorize one real CALL-E phone call within the displayed window.",
  ],
  [
    "recipient_consent_confirmed",
    "I confirmed the recipient consents to this authorized AI-assisted call.",
  ],
] as const;

export function FieldCloseWorkbench({ route }: { route: WorkspaceRoute }) {
  const session = authClient.useSession();
  const configuration = useWorkspaceConfiguration();

  if (session.isPending) {
    return <LoadingScreen />;
  }

  if (!session.data?.user) {
    return <SignInScreen returnTo="/workspace" />;
  }

  return (
    <AuthenticatedWorkbench
      configuration={configuration}
      route={route}
      user={{
        id: session.data.user.id,
        name: session.data.user.name,
        email: session.data.user.email,
      }}
    />
  );
}

function AuthenticatedWorkbench({
  configuration,
  route,
  user,
}: {
  configuration: {
    phoneProtectionReady: boolean;
    showLocalSetupHint: boolean;
  };
  route: WorkspaceRoute;
  user: { id: string; name: string; email: string };
}) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [preview, setPreview] = useState<CallPreview | null>(null);
  const [defaultWorkOrder, setDefaultWorkOrder] = useState<string>(
    PRESET_DEMO_WORK_ORDER.workOrderRef,
  );
  const [selectedScenario, setSelectedScenario] = useState("resolved_clear");
  const [attestations, setAttestations] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState<string | null>("bootstrap");
  const [error, setError] = useState<string | null>(null);
  const [detailLoadState, setDetailLoadState] =
    useState<DetailLoadState>("idle");
  const [workspaceLoadState, setWorkspaceLoadState] =
    useState<WorkspaceLoadState>("loading");
  const [newCaseFieldErrors, setNewCaseFieldErrors] =
    useState<NewCaseFieldErrors>({});
  const [newCaseFormError, setNewCaseFormError] = useState<string | null>(null);
  const view = route.view;
  const selectedCaseId = route.caseId ?? null;
  const showNewCase = Boolean(route.newCase);
  const canCreateCases =
    workspaceLoadState === "ready" && configuration.phoneProtectionReady;

  const loadCases = useCallback(
    async (workspaceId: string) => {
      const response = await requestJson<{ cases: CaseSummary[] }>(
        `/api/cases?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      setCases(response.cases);
      return response.cases;
    },
    [],
  );

  const loadDetail = useCallback(
    async (selectedWorkspace: Workspace, caseId: string) => {
      const caseDetail = await requestJson<CaseDetail>(
        `/api/cases/${caseId}?workspaceId=${encodeURIComponent(selectedWorkspace.id)}`,
      );
      setDetail(caseDetail);

      if (!caseDetail.attempt && caseDetail.case.status === "draft") {
        const previewResponse = await requestJson<{ preview: CallPreview }>(
          `/api/cases/${caseId}/preview?workspaceId=${encodeURIComponent(selectedWorkspace.id)}&mode=${workspaceMode(selectedWorkspace)}`,
        );
        setPreview(previewResponse.preview);
      } else {
        setPreview(null);
      }

      return caseDetail;
    },
    [],
  );

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        setError(null);
        setWorkspaceLoadState("loading");
        const demoResponse = await requestJson<{ "workspace": Workspace }>(
          "/api/workspaces",
          { method: "POST" },
        );
        const listed = await requestJson<{ workspaces: Workspace[] }>(
          "/api/workspaces",
        );

        if (!active) {
          return;
        }

        const availableWorkspaces = listed.workspaces.length
          ? listed.workspaces
          : [demoResponse.workspace];
        const requestedWorkspace = route.workspaceSlug
          ? availableWorkspaces.find(
              (item) => item.slug === route.workspaceSlug,
            )
          : null;

        if (route.workspaceSlug && !requestedWorkspace) {
          setWorkspaces(availableWorkspaces);
          setWorkspace(null);
          setCases([]);
          setDetail(null);
          setDetailLoadState("idle");
          setWorkspaceLoadState("unavailable");
          setError(
            "This workspace is unavailable or you do not have permission to open it.",
          );
          return;
        }

        const lastWorkspaceSlug =
          window.localStorage.getItem("fieldclose.last-workspace");
        const initialWorkspace =
          requestedWorkspace ??
          availableWorkspaces.find(
            (item) => item.slug === lastWorkspaceSlug,
          ) ??
          availableWorkspaces.find(
            (item) => item.id === demoResponse.workspace.id,
          ) ??
          availableWorkspaces[0];

        if (!initialWorkspace) {
          throw new Error("No accessible workspace was returned");
        }

        setWorkspaces(availableWorkspaces);
        setWorkspace(initialWorkspace);
        setWorkspaceLoadState("ready");
        setDefaultWorkOrder(
          createNewCaseWorkOrderReference(workspaceMode(initialWorkspace)),
        );
        window.localStorage.setItem(
          "fieldclose.last-workspace",
          initialWorkspace.slug,
        );
        await loadCases(initialWorkspace.id);

        if (!route.workspaceSlug) {
          router.replace(`/workspace/${initialWorkspace.slug}/cases`);
        }
      } catch (caught) {
        if (active) {
          setWorkspaceLoadState("unavailable");
          setError(readableError(caught));
        }
      } finally {
        if (active) {
          setBusyAction(null);
        }
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [loadCases, route.workspaceSlug, router, user.id]);

  useEffect(() => {
    if (!workspace || !selectedCaseId || showNewCase) {
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(() => {
      setError(null);
      setDetail(null);
      setPreview(null);
      setDetailLoadState("loading");
      void loadDetail(workspace, selectedCaseId)
        .then(() => {
          if (active) {
            setDetailLoadState("ready");
          }
        })
        .catch((caught) => {
          if (active) {
            setDetailLoadState(detailStateForError(caught));
          }
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [loadDetail, selectedCaseId, showNewCase, workspace]);

  useEffect(() => {
    if (
      !workspace ||
      !selectedCaseId ||
      detail?.case.id !== selectedCaseId ||
      detail.attempt?.mode !== "live" ||
      !detail.attempt.providerCallId ||
      detail.result ||
      detail.case.status === "needs_attention"
    ) {
      return;
    }

    let active = true;
    let timeoutId: number | undefined;
    const attemptId = detail.attempt.id;

    const refresh = async () => {
      try {
        await requestJson(`/api/attempts/${attemptId}/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId: workspace.id }),
        });
        await Promise.all([
          loadCases(workspace.id),
          loadDetail(workspace, selectedCaseId),
        ]);
      } catch (caught) {
        if (active) {
          setError(readableError(caught));
        }
      } finally {
        if (active) {
          timeoutId = window.setTimeout(() => void refresh(), 5_000);
        }
      }
    };

    timeoutId = window.setTimeout(() => void refresh(), 5_000);

    return () => {
      active = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [detail, loadCases, loadDetail, selectedCaseId, workspace]);

  const exceptionCases = useMemo(
    () =>
      cases.filter((item) =>
        ["needs_attention", "failed"].includes(item.status),
      ),
    [cases],
  );

  const visibleCases = view === "exceptions" ? exceptionCases : cases;
  const openCaseCount = cases.filter(
    (item) => !["closed", "cancelled"].includes(item.status),
  ).length;
  const awaitingVerificationCount = cases.filter((item) =>
    ["draft", "approved", "calling"].includes(item.status),
  ).length;
  const reviewReadyCount = cases.filter(
    (item) => item.status === "completed",
  ).length;
  const activeDetail = detail?.case.id === selectedCaseId ? detail : null;
  const activePreview = preview?.caseId === selectedCaseId ? preview : null;
  const activeDetailLoadState =
    workspace && selectedCaseId && !showNewCase ? detailLoadState : "idle";
  const detailLoading = activeDetailLoadState === "loading";

  async function handleCreateCase(input: NewCaseInput) {
    if (!workspace) {
      return;
    }

    setBusyAction("create");
    setError(null);
    setNewCaseFieldErrors({});
    setNewCaseFormError(null);

    try {
      const response = await requestJson<{ case: { id: string } }>(
        "/api/cases",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: workspace.id,
            mode: workspaceMode(workspace),
            case: input,
          }),
        },
      );
      setAttestations(new Set());
      await loadCases(workspace.id);
      router.push(
        `/workspace/${workspace.slug}/cases/${response.case.id}`,
      );
    } catch (caught) {
      const fieldErrors = newCaseErrors(caught);
      setNewCaseFieldErrors(fieldErrors);
      setNewCaseFormError(
        Object.keys(fieldErrors).length > 0 ? null : readableError(caught),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleApprove() {
    if (!workspace || !preview) {
      return;
    }

    setBusyAction("approve");
    setError(null);

    try {
      await requestJson(`/api/cases/${preview.caseId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          mode: preview.mode,
          approval: {
            expectedCaseVersion: preview.caseVersion,
            expectedBriefHash: preview.briefHash,
            callingWindow: createCallingWindow(
              preview.brief.recipient.timezone,
            ),
            operatorAttestations: [...attestations],
          },
        }),
      });
      await loadCases(workspace.id);
      await loadDetail(workspace, preview.caseId);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleExecute() {
    if (!workspace || !detail?.attempt) {
      return;
    }

    setBusyAction("execute");
    setError(null);

    try {
      await requestJson(`/api/attempts/${detail.attempt.id}/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          mode: workspaceMode(workspace),
          ...(workspaceMode(workspace) === "fake"
            ? { scenarioId: selectedScenario }
            : {}),
        }),
      });
      await loadCases(workspace.id);
      await loadDetail(workspace, detail.case.id);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRefresh() {
    if (!workspace || !detail?.attempt) {
      return;
    }

    setBusyAction("refresh");
    setError(null);

    try {
      await requestJson(`/api/attempts/${detail.attempt.id}/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id }),
      });
      await Promise.all([
        loadCases(workspace.id),
        loadDetail(workspace, detail.case.id),
      ]);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDisposition(input: {
    taskId: string;
    outcome: HumanDispositionOutcome;
    resolutionNote: string | null;
  }) {
    if (!workspace || !detail) {
      return;
    }

    const caseId = detail.case.id;
    setBusyAction("disposition");
    setError(null);

    try {
      await requestJson(`/api/cases/${caseId}/disposition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          expectedCaseVersion: detail.case.version,
          ...input,
        }),
      });
      await Promise.all([
        loadCases(workspace.id),
        loadDetail(workspace, caseId),
      ]);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        ["stale_case_version", "human_disposition_conflict"].includes(
          caught.code,
        )
      ) {
        await Promise.allSettled([
          loadCases(workspace.id),
          loadDetail(workspace, caseId),
        ]);
      }
      setError(readableError(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSignOut() {
    setBusyAction("signout");
    setError(null);

    try {
      const response = await authClient.signOut();

      if (response.error) {
        throw new ApiError("sign_out_failed");
      }

      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(readableError(caught));
      setBusyAction(null);
    }
  }

  function openNewCase() {
    setDefaultWorkOrder(
      createNewCaseWorkOrderReference(workspaceMode(workspace)),
    );
    setError(null);
    setNewCaseFieldErrors({});
    setNewCaseFormError(null);
    if (workspace) {
      router.push(`/workspace/${workspace.slug}/cases/new`);
    }
  }

  async function handleWorkspaceChange(workspaceId: string) {
    const nextWorkspace = workspaces.find((item) => item.id === workspaceId);

    if (!nextWorkspace || nextWorkspace.id === workspace?.id) {
      return;
    }

    setBusyAction("workspace");
    setError(null);
    setNewCaseFieldErrors({});
    setNewCaseFormError(null);
    setDetail(null);
    setPreview(null);
    setAttestations(new Set());
    window.localStorage.setItem(
      "fieldclose.last-workspace",
      nextWorkspace.slug,
    );
    setDefaultWorkOrder(
      createNewCaseWorkOrderReference(workspaceMode(nextWorkspace)),
    );
    router.push(`/workspace/${nextWorkspace.slug}/cases`);
  }

  return (
    <div className="app-shell">
      <AppHeader
        activeView={view}
        onNewCase={
          canCreateCases &&
          view === "cases" &&
          !selectedCaseId &&
          !showNewCase
            ? openNewCase
            : null
        }
        onSignOut={handleSignOut}
        signingOut={busyAction === "signout"}
        user={user}
        workspaceSlug={workspace?.slug ?? route.workspaceSlug}
      />

      <main className="app-main" id="main-content">
        <section className="workspace-intro">
          <div className="workspace-title-block">
            <p className="eyebrow">
              Operations /{" "}
              {workspaceMode(workspace) === "live"
                ? "Protected CALL-E"
                : "Simulation environment"}
            </p>
            <h1>{viewHeading(view)}</h1>
            <p className="workspace-subtitle">
              Review service evidence, control approved calls, and route every
              decision to the right person.
            </p>
          </div>
          <div
            className={`workspace-meta ${workspaceMode(workspace) === "live" ? "workspace-meta-live" : ""}`}
            aria-label="Workspace safety status"
          >
            <span>Workspace</span>
            {workspaces.length > 1 && workspace ? (
              <select
                aria-label="Active workspace"
                className="workspace-select"
                onChange={(event) =>
                  void handleWorkspaceChange(event.target.value)
                }
                value={workspace.id}
              >
                {workspaces.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{workspace?.displayName ?? "Establishing…"}</strong>
            )}
            <span
              className={`mode-label ${workspaceMode(workspace) === "live" ? "mode-label-live" : ""}`}
            >
              <i aria-hidden="true" />{" "}
              {workspaceMode(workspace) === "live"
                ? "Protected live calls"
                : "Simulated calls only"}
            </span>
          </div>
          <div className="workspace-summary" aria-label="Workspace case summary">
            <div>
              <span>Open queue</span>
              <strong>{String(openCaseCount).padStart(2, "0")}</strong>
            </div>
            <div>
              <span>Call verification</span>
              <strong>
                {String(awaitingVerificationCount).padStart(2, "0")}
              </strong>
            </div>
            <div>
              <span>Review ready</span>
              <strong>{String(reviewReadyCount).padStart(2, "0")}</strong>
            </div>
            <div className={exceptionCases.length ? "has-attention" : ""}>
              <span>Needs attention</span>
              <strong>{String(exceptionCases.length).padStart(2, "0")}</strong>
            </div>
          </div>
        </section>

        {error ? (
          <div className="global-error" role="alert">
            <strong>Action stopped safely.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {!configuration.phoneProtectionReady ? (
          <div className="configuration-notice" role="status">
            <strong>Case creation is not configured.</strong>
            <span>
              An operator must configure separate encryption and lookup keys
              before contact data can be stored.
              {configuration.showLocalSetupHint
                ? " Run pnpm setup:local-demo for this local fake-only environment."
                : ""}
            </span>
          </div>
        ) : null}

        {busyAction === "bootstrap" ? (
          <WorkspaceLoading />
        ) : workspaceLoadState === "unavailable" ? (
          <WorkspaceUnavailable />
        ) : (
          <div
            className={`workbench-grid ${
              showNewCase
                ? "route-form workbench-grid-form"
                : selectedCaseId
                  ? "route-detail has-active-case"
                  : "route-list"
            }`}
          >
            {showNewCase ? null : (
              <CaseRail
                activeCaseId={selectedCaseId}
                allCasesHref={
                  workspace
                    ? `/workspace/${workspace.slug}/cases`
                    : "/workspace"
                }
                cases={visibleCases}
                emptyLabel={
                  view === "exceptions"
                    ? "No exceptions need attention."
                    : "No closeout cases yet."
                }
                hrefForCase={(caseId) =>
                  workspace
                    ? `/workspace/${workspace.slug}/${view}/${caseId}`
                    : "/workspace"
                }
                onNewCase={openNewCase}
                queueView={view}
                showNewAction={view === "cases" && canCreateCases}
              />
            )}

            {showNewCase && !configuration.phoneProtectionReady ? (
              <CaseCreationUnavailable
                showLocalSetupHint={configuration.showLocalSetupHint}
              />
            ) : showNewCase ? (
              <NewCaseForm
                busy={busyAction === "create"}
                defaultWorkOrder={defaultWorkOrder}
                fieldErrors={newCaseFieldErrors}
                formError={newCaseFormError}
                key={workspace?.id ?? "workspace-loading"}
                mode={workspaceMode(workspace)}
                onCancel={() => {
                  if (workspace) {
                    router.push(`/workspace/${workspace.slug}/cases`);
                  }
                }}
                onFieldErrorsChange={setNewCaseFieldErrors}
                onFormErrorChange={setNewCaseFormError}
                onSubmit={handleCreateCase}
              />
            ) : view === "audit" ? (
              <AuditView
                casesHref={
                  workspace ? `/workspace/${workspace.slug}/cases` : undefined
                }
                detail={activeDetail}
                loadState={activeDetailLoadState}
                loading={detailLoading}
                user={user}
              />
            ) : (
              <CaseWorkspace
                auditHref={
                  workspace && selectedCaseId
                    ? `/workspace/${workspace.slug}/audit/${selectedCaseId}`
                    : undefined
                }
                attestations={attestations}
                busyAction={busyAction}
                canRecordDisposition={
                  workspace?.role === "owner" || workspace?.role === "operator"
                }
                casesHref={
                  workspace
                    ? `/workspace/${workspace.slug}/cases`
                    : undefined
                }
                detail={activeDetail}
                loadState={activeDetailLoadState}
                loading={detailLoading}
                onApprove={handleApprove}
                onAttestationChange={setAttestations}
                onExecute={handleExecute}
                onDisposition={handleDisposition}
                onRefresh={handleRefresh}
                onScenarioChange={setSelectedScenario}
                preview={activePreview}
                selectedScenario={selectedScenario}
                userId={user.id}
                workspaceMode={workspaceMode(workspace)}
                view={view}
              />
            )}
          </div>
        )}

        <p className="sr-only" aria-live="polite">
          {busyAction ? `Working: ${busyAction}` : "Ready"}
        </p>
      </main>
    </div>
  );
}

function AppHeader({
  activeView,
  onNewCase,
  onSignOut,
  signingOut,
  user,
  workspaceSlug,
}: {
  activeView: ViewName;
  onNewCase: (() => void) | null;
  onSignOut: () => Promise<void>;
  signingOut: boolean;
  user: { name: string; email: string };
  workspaceSlug: string | undefined;
}) {
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <BrandMark />
        <div>
          <strong>{projectConfig.name}</strong>
          <span>Closeout operations</span>
        </div>
      </div>

      <nav aria-label="Primary" className="primary-nav">
        {(["cases", "exceptions", "audit"] as const).map((item) => (
          <Link
            aria-current={activeView === item ? "page" : undefined}
            href={
              workspaceSlug
                ? `/workspace/${workspaceSlug}/${item}`
                : "/workspace"
            }
            key={item}
          >
            {item === "cases"
              ? "Cases"
              : item === "exceptions"
                ? "Exceptions"
                : "Audit"}
          </Link>
        ))}
      </nav>

      <div className="header-actions">
        {onNewCase ? (
          <button className="header-new-button" onClick={onNewCase} type="button">
            <span aria-hidden="true">＋</span> New case
          </button>
        ) : null}
        <div className="user-menu-copy" title={user.email}>
          <span>{initials(user.name)}</span>
          <strong>{user.name}</strong>
        </div>
        <button
          className="sign-out-button"
          disabled={signingOut}
          onClick={() => void onSignOut()}
          type="button"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </header>
  );
}

function CaseRail({
  activeCaseId,
  allCasesHref,
  cases,
  emptyLabel,
  hrefForCase,
  onNewCase,
  queueView,
  showNewAction,
}: {
  activeCaseId: string | null;
  allCasesHref: string;
  cases: CaseSummary[];
  emptyLabel: string;
  hrefForCase: (caseId: string) => string;
  onNewCase: () => void;
  queueView: ViewName;
  showNewAction: boolean;
}) {
  const isExceptionQueue = queueView === "exceptions";
  const queueHeading = isExceptionQueue ? "Exceptions queue" : "Closeout cases";

  return (
    <aside
      className={`case-rail ${activeCaseId ? "case-rail-compact" : "case-rail-table"}`}
      aria-label={queueHeading}
    >
      <div className="rail-heading">
        <div>
          <span>Operations queue</span>
          <strong>{queueHeading}</strong>
        </div>
        <div className="rail-heading-actions">
          <span>{cases.length} visible</span>
          {cases.length && showNewAction ? (
            <button
              className="rail-mobile-new-button"
              onClick={onNewCase}
              type="button"
            >
              <span aria-hidden="true">＋</span> New case
            </button>
          ) : null}
        </div>
      </div>
      {cases.length ? (
        <>
          {activeCaseId ? null : (
            <div className="case-table-head" aria-hidden="true">
              <span>Work order / customer</span>
              <span>Site</span>
              <span>Workflow status</span>
              <span>Contact / updated</span>
            </div>
          )}
          <ol className="case-list">
            {cases.map((item) => (
              <li key={item.id}>
                <Link
                  aria-current={activeCaseId === item.id ? "true" : undefined}
                  href={hrefForCase(item.id)}
                >
                  <span className="case-work-order">
                    <strong>{item.workOrderRef}</strong>
                    <small>{item.contractorDisplayName}</small>
                  </span>
                  <span className="case-site">{item.siteLabel}</span>
                  <span className="case-row-status">
                    <StatusLabel status={item.status} />
                  </span>
                  <span className="case-list-foot">
                    <span>{item.phoneMasked}</span>
                    <time dateTime={item.updatedAt}>
                      {shortDate(item.updatedAt)}
                    </time>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className={`rail-empty${isExceptionQueue ? " rail-empty-clear" : ""}`}>
          {isExceptionQueue ? (
            <>
              <span aria-hidden="true" className="rail-empty-mark">
                <svg fill="none" viewBox="0 0 24 24">
                  <path d="m6.5 12.5 3.25 3.25L17.8 7.7" />
                </svg>
              </span>
              <div className="rail-empty-copy">
                <span className="rail-empty-kicker">Queue clear</span>
                <h2>{emptyLabel}</h2>
                <p>
                  Cases appear here only when provider results or workflow state
                  require a person to decide the next step.
                </p>
              </div>
              <Link className="rail-empty-action" href={allCasesHref}>
                View all closeout cases <span aria-hidden="true">→</span>
              </Link>
            </>
          ) : (
            <>
              <span aria-hidden="true" className="rail-empty-mark">
                <svg fill="none" viewBox="0 0 24 24">
                  <path d="M8.5 4.5h7a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" />
                  <path d="M9.5 8h5M9.5 11.5h5M9.5 15h3" />
                </svg>
              </span>
              <div className="rail-empty-copy">
                <span className="rail-empty-kicker">Closeout queue</span>
                <h2>{emptyLabel}</h2>
                <p>
                  Completed work orders land here once a closeout case is
                  created and ready for review.
                </p>
              </div>
              {showNewAction ? (
                <button
                  className="rail-empty-action"
                  onClick={onNewCase}
                  type="button"
                >
                  Create the first case <span aria-hidden="true">→</span>
                </button>
              ) : null}
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function CaseWorkspace({
  auditHref,
  attestations,
  busyAction,
  canRecordDisposition,
  casesHref,
  detail,
  loadState,
  loading,
  onApprove,
  onAttestationChange,
  onDisposition,
  onExecute,
  onRefresh,
  onScenarioChange,
  preview,
  selectedScenario,
  userId,
  workspaceMode,
  view,
}: {
  auditHref: string | undefined;
  attestations: Set<string>;
  busyAction: string | null;
  canRecordDisposition: boolean;
  casesHref: string | undefined;
  detail: CaseDetail | null;
  loadState: DetailLoadState;
  loading: boolean;
  onApprove: () => Promise<void>;
  onAttestationChange: (values: Set<string>) => void;
  onDisposition: (input: {
    taskId: string;
    outcome: HumanDispositionOutcome;
    resolutionNote: string | null;
  }) => Promise<void>;
  onExecute: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onScenarioChange: (scenarioId: string) => void;
  preview: CallPreview | null;
  selectedScenario: string;
  userId: string;
  workspaceMode: "fake" | "live";
  view: ViewName;
}) {
  if (loading && !detail) {
    return <PanelLoading label="Loading case record" />;
  }

  if (
    !detail &&
    ["not_found", "access_denied", "error"].includes(loadState)
  ) {
    return <CaseUnavailable />;
  }

  if (!detail) {
    return (
      <section className="workspace-panel empty-workspace empty-state empty-state--neutral">
        <span aria-hidden="true" className="empty-index">
          FC / 01
        </span>
        <div aria-hidden="true" className="empty-state-icon">
          <svg fill="none" viewBox="0 0 24 24">
            <path d="M8 4.5h8a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" />
            <path d="M9 8h6M9 11.5h6M9 15h4" />
          </svg>
        </div>
        <p className="empty-state-eyebrow">Case workspace</p>
        <h2>Select a case to begin.</h2>
        <p className="empty-copy">
          Each case keeps the reviewed brief, one exact approval, provider state,
          normalized result, and human next action together.
        </p>
        {casesHref ? (
          <div className="empty-actions">
            <Link className="secondary-button" href={casesHref}>
              Browse closeout cases
            </Link>
          </div>
        ) : null}
      </section>
    );
  }

  if (view === "exceptions") {
    return (
      <section className="workspace-panel">
        <CaseHeading auditHref={auditHref} detail={detail} />
        <ExceptionView
          busy={busyAction === "disposition"}
          canRecordDisposition={canRecordDisposition}
          detail={detail}
          onDisposition={onDisposition}
          userId={userId}
        />
      </section>
    );
  }

  return (
    <section className="workspace-panel">
      <CaseHeading auditHref={auditHref} detail={detail} />
      <WorkflowProgress detail={detail} mode={workspaceMode} />

      {!detail.attempt ? (
        <ApprovalView
          attestations={attestations}
          busy={busyAction === "approve"}
          onApprove={onApprove}
          onAttestationChange={onAttestationChange}
          preview={preview}
        />
      ) : detail.result ||
        ["ambiguous_requires_reconciliation", "failed_before_acceptance"].includes(
          detail.attempt.creationDisposition,
        ) ? (
        <ResultView
          busy={busyAction === "disposition"}
          canRecordDisposition={canRecordDisposition}
          detail={detail}
          onDisposition={onDisposition}
          userId={userId}
        />
      ) : detail.attempt.mode === "live" ? (
        <LiveCallView
          busy={busyAction === "execute" || busyAction === "refresh"}
          detail={detail}
          onExecute={onExecute}
          onRefresh={onRefresh}
        />
      ) : (
        <SimulationView
          busy={busyAction === "execute"}
          detail={detail}
          onExecute={onExecute}
          onScenarioChange={onScenarioChange}
          selectedScenario={selectedScenario}
        />
      )}
    </section>
  );
}

function CaseHeading({
  auditHref,
  detail,
}: {
  auditHref?: string;
  detail: CaseDetail;
}) {
  return (
    <div className="case-heading">
      <div className="case-heading-copy">
        <p className="eyebrow">{detail.case.workOrderRef}</p>
        <h2>{detail.case.siteLabel}</h2>
        <p>
          {detail.case.visitContext.equipmentLabel} · Service completed{" "}
          {detail.case.visitContext.serviceDate}
        </p>
      </div>
      <div className="case-heading-status">
        <StatusLabel status={detail.case.status} />
        <span>Case v{detail.case.version}</span>
        {auditHref ? (
          <Link className="case-audit-link" href={auditHref}>
            Open audit
          </Link>
        ) : null}
      </div>
      <dl className="case-summary-facts">
        <div>
          <dt>Customer</dt>
          <dd>{detail.case.contractorDisplayName}</dd>
        </div>
        <div>
          <dt>Authorized contact</dt>
          <dd>
            {humanize(detail.case.contact.role)} ·{" "}
            {detail.case.contact.phoneMasked}
          </dd>
        </div>
        <div>
          <dt>Timezone</dt>
          <dd>{detail.case.timezone}</dd>
        </div>
        <div>
          <dt>Required action</dt>
          <dd>{caseRequiredAction(detail)}</dd>
        </div>
      </dl>
    </div>
  );
}

function WorkflowProgress({
  detail,
  mode,
}: {
  detail: CaseDetail;
  mode: "fake" | "live";
}) {
  const callVerificationComplete = Boolean(detail.result || detail.disposition);
  const invoiceReviewCurrent =
    Boolean(detail.result) && detail.case.status !== "closed";
  const completionComplete = detail.case.status === "closed";
  const steps = [
    {
      label: "Technician visit",
      state: "complete",
      detail: "Complete",
    },
    {
      label: "Closeout preparation",
      state: "complete",
      detail: "Complete",
    },
    {
      label: "Call verification",
      state: callVerificationComplete ? "complete" : "current",
      detail: callVerificationComplete
        ? "Evidence received"
        : detail.attempt
          ? mode === "live"
            ? "Approved CALL-E flow"
            : "Approved simulation"
          : "Brief approval",
    },
    {
      label: "Invoice review",
      state: completionComplete
        ? "complete"
        : invoiceReviewCurrent
          ? "current"
          : "pending",
      detail: completionComplete
        ? "Complete"
        : invoiceReviewCurrent
          ? "Human owned"
          : "Pending",
    },
    {
      label: "Completion status",
      state: completionComplete ? "complete" : "pending",
      detail: completionComplete ? "Closed by operator" : "Human decision",
    },
  ] as const;

  return (
    <ol className="workflow-progress" aria-label="Case workflow progress">
      {steps.map((step, index) => (
        <li
          aria-current={step.state === "current" ? "step" : undefined}
          className={`is-${step.state}`}
          key={step.label}
        >
          <span className="workflow-step-index">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="workflow-step-copy">
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ApprovalView({
  attestations,
  busy,
  onApprove,
  onAttestationChange,
  preview,
}: {
  attestations: Set<string>;
  busy: boolean;
  onApprove: () => Promise<void>;
  onAttestationChange: (values: Set<string>) => void;
  preview: CallPreview | null;
}) {
  if (!preview) {
    return <PanelLoading label="Building protected brief preview" />;
  }

  const attestationOptions =
    preview.mode === "live"
      ? liveApprovalAttestations
      : fakeApprovalAttestations;
  const fullyAttested = attestationOptions.every(([value]) =>
    attestations.has(value),
  );
  const live = preview.mode === "live";

  return (
    <div className="approval-layout">
      <div className="brief-document">
        <div className="document-kicker">
          <span>Exact call brief</span>
          <strong className={live ? "live-document-state" : ""}>
            {live ? "LIVE / EXTERNAL EFFECT" : "FAKE / NO NETWORK"}
          </strong>
        </div>
        <blockquote>{preview.brief.disclosure}</blockquote>
        <dl className="brief-facts">
          <div>
            <dt>Recipient</dt>
            <dd>
              {preview.brief.recipient.nameOrRole} ·{" "}
              {preview.brief.recipient.phoneMasked}
            </dd>
          </div>
          <div>
            <dt>Purpose</dt>
            <dd>{preview.brief.objective}</dd>
          </div>
          <div>
            <dt>Permitted reference</dt>
            <dd>{preview.brief.allowedReferenceText}</dd>
          </div>
        </dl>
        <div className="brief-columns">
          <div>
            <h3>Questions</h3>
            <ol>
              {preview.brief.questions.map((question) => (
                <li key={question}>{humanize(question)}</li>
              ))}
            </ol>
          </div>
          <div>
            <h3>Hard boundaries</h3>
            <ul>
              {preview.brief.prohibitedActions.slice(0, 5).map((action) => (
                <li key={action}>No {humanize(action)}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="document-footnote">
          No voicemail. At most one bounded clarification per question. The
          contractor—not the AI—decides the next action.
        </p>
      </div>

      <aside
        className={`approval-checklist ${live ? "approval-checklist-live" : ""}`}
      >
        <p className="eyebrow">Human checkpoint</p>
        <h3>
          {live ? "Authorize one exact phone call" : "Approve one exact simulation"}
        </h3>
        <p>
          {live
            ? "Approval binds this recipient, case version, brief digest, consent record, and today's local calling window to one attempt."
            : "Approval binds this case version and brief digest to a single server-created attempt."}
        </p>
        <div className="attestation-list">
          {attestationOptions.map(([value, label]) => (
            <label key={value}>
              <input
                checked={attestations.has(value)}
                onChange={(event) => {
                  const next = new Set(attestations);

                  if (event.target.checked) {
                    next.add(value);
                  } else {
                    next.delete(value);
                  }

                  onAttestationChange(next);
                }}
                type="checkbox"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <button
          className="primary-button full-width"
          disabled={!fullyAttested || busy}
          onClick={() => void onApprove()}
          type="button"
        >
          {busy
            ? "Recording approval…"
            : live
              ? "Authorize one live attempt"
              : "Approve fake attempt"}
        </button>
        <code className="brief-hash">Digest {preview.briefHash.slice(0, 12)}…</code>
      </aside>
    </div>
  );
}

function LiveCallView({
  busy,
  detail,
  onExecute,
  onRefresh,
}: {
  busy: boolean;
  detail: CaseDetail;
  onExecute: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const accepted = Boolean(detail.attempt?.providerCallId);
  const recoveryPending =
    !accepted &&
    (Boolean(detail.attempt?.requestedAt) || detail.case.status === "calling");
  const needsReconciliation = detail.case.status === "needs_attention";

  return (
    <div className="simulation-layout live-call-layout">
      <div className="simulation-hero live-call-hero">
        <span className="simulation-index">LIVE / 01</span>
        <p className="eyebrow">
          {needsReconciliation
            ? "CALL-E status unresolved"
            : accepted
              ? "CALL-E accepted"
              : recoveryPending
                ? "CALL-E acceptance recovery"
              : "Approved external action"}
        </p>
        <h3>
          {needsReconciliation
            ? "Provider status needs manual review."
            : accepted
              ? "Checking CALL-E status."
              : recoveryPending
                ? "Recover the idempotent provider request."
              : "One click can place the approved phone call."}
        </h3>
        <p>
          {needsReconciliation
            ? "Automatic checks have stopped. Refresh the existing provider call or reconcile it manually; FieldClose will not redial."
            : accepted
              ? "FieldClose checks CALL-E every five seconds while this page is active. No automatic retry will run while this call is unresolved."
              : recoveryPending
                ? "The previous acceptance write may not have completed. For one minute after the original claim, this action only rechecks local state; afterward it reuses the same provider idempotency key to recover the existing call identifier."
                : "The server will recheck the kill switch, contact authorization, do-not-call state, exact brief, and local calling window before it invokes CALL-E."}
        </p>
        <div className="attempt-facts">
          <span>
            Attempt <code>{detail.attempt?.id.slice(0, 8)}</code>
          </span>
          <span>Provider CALL-E</span>
          <span>Live approved: yes</span>
          {detail.attempt?.providerCallId ? (
            <span>
              Call <code>{detail.attempt.providerCallId.slice(0, 14)}</code>
            </span>
          ) : null}
        </div>
      </div>

      <aside className="scenario-picker live-call-action">
        <p className="eyebrow">External side effect</p>
        <h3>
          {needsReconciliation
            ? "Manual reconciliation"
            : accepted
              ? "Result pending"
              : "Final server preflight"}
        </h3>
        <p>
          {accepted
            ? "Only an authenticated CALL-E lookup with the matching provider call ID can advance this case."
            : "No voicemail, no automatic retry, one recipient, one approved purpose."}
        </p>
        <div className="live-call-seal">
          <strong>
            {needsReconciliation
              ? "Manual review required"
              : accepted
                ? "Status polling active"
                : "Real phone call"}
          </strong>
          <span>
            {accepted
              ? "5-second status refresh · retry frozen"
              : "CALL-E · one idempotent attempt"}
          </span>
        </div>
        <button
          className="primary-button live-action-button full-width"
          disabled={busy}
          onClick={() => void (accepted ? onRefresh() : onExecute())}
          type="button"
        >
          {busy
            ? accepted
              ? "Refreshing provider status…"
              : "Running final preflight…"
            : accepted
              ? "Refresh provider status"
              : recoveryPending
                ? "Recover CALL-E acceptance"
                : "Place one approved CALL-E call"}
        </button>
      </aside>
    </div>
  );
}

function SimulationView({
  busy,
  detail,
  onExecute,
  onScenarioChange,
  selectedScenario,
}: {
  busy: boolean;
  detail: CaseDetail;
  onExecute: () => Promise<void>;
  onScenarioChange: (scenarioId: string) => void;
  selectedScenario: string;
}) {
  return (
    <div className="simulation-layout">
      <div className="simulation-hero">
        <span className="simulation-index">SIM / 01</span>
        <p className="eyebrow">Approved attempt</p>
        <h3>Choose the conversation outcome to exercise.</h3>
        <p>
          The fake provider crosses the same application boundary as CALL-E,
          then returns deterministic structured data without a network request.
        </p>
        <div className="attempt-facts">
          <span>
            Attempt <code>{detail.attempt?.id.slice(0, 8)}</code>
          </span>
          <span>Provider fake</span>
          <span>Live approved: no</span>
        </div>
      </div>

      <div className="scenario-picker">
        <label htmlFor="scenario">Simulation outcome</label>
        <select
          className="field-control"
          id="scenario"
          onChange={(event) => onScenarioChange(event.target.value)}
          value={selectedScenario}
        >
          {scenarioOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <p>
          {scenarioOptions.find(([value]) => value === selectedScenario)?.[2]}
        </p>
        <div className="no-call-seal">
          <strong>No phone call</strong>
          <span>Fake provider · deterministic fixture</span>
        </div>
        <button
          className="primary-button full-width"
          disabled={busy}
          onClick={() => void onExecute()}
          type="button"
        >
          {busy ? "Running simulation…" : "Run approved simulation"}
        </button>
      </div>
    </div>
  );
}

type DispositionActionProps = {
  busy: boolean;
  canRecordDisposition: boolean;
  detail: CaseDetail;
  onDisposition: (input: {
    taskId: string;
    outcome: HumanDispositionOutcome;
    resolutionNote: string | null;
  }) => Promise<void>;
  userId: string;
};

function ResultView({
  busy,
  canRecordDisposition,
  detail,
  onDisposition,
  userId,
}: DispositionActionProps) {
  if (!detail.result) {
    const ambiguous =
      detail.attempt?.creationDisposition ===
      "ambiguous_requires_reconciliation";

    return (
      <div className="result-state result-state-attention">
        <p className="eyebrow">Provider boundary</p>
        <h3>{ambiguous ? "Creation outcome is unknown." : "Creation failed safely."}</h3>
        <p>
          {ambiguous
            ? "FieldClose froze retry and created a reconciliation task. A new attempt is blocked until a human resolves the original request."
            : "The provider proved that no call was accepted. The failure is stored separately from an ambiguous outcome."}
        </p>
        <NextAction tasks={detail.tasks} />
        <DispositionControl
          busy={busy}
          canRecordDisposition={canRecordDisposition}
          detail={detail}
          onDisposition={onDisposition}
          userId={userId}
        />
      </div>
    );
  }

  const result = detail.result;

  return (
    <div className="result-layout">
      <div className="result-primary">
        <p className="eyebrow">Normalized recommendation</p>
        <div className={`route-banner route-${result.route}`}>
          <span>Recommended route</span>
          <strong>{routeLabel(result.route)}</strong>
        </div>
        <h3>{result.summary}</h3>
        <p className="result-disclaimer">
          Provider status “{humanize(result.providerTaskStatus)}” is evidence of
          task processing—not automatic work-order closure.
        </p>

        <div className="result-measures">
          <ResultMeasure
            label="Contact"
            value={humanize(result.contactVerification)}
          />
          <ResultMeasure
            label="Operating report"
            value={humanize(result.observedOperatingStatus)}
          />
          <ResultMeasure
            label="Unresolved issue"
            value={answerLabel(result.unresolvedIssue)}
          />
          <ResultMeasure
            label="Return visit"
            value={answerLabel(result.returnVisitRequested)}
          />
        </div>
      </div>

      <aside className="result-sidebar">
        <NextAction tasks={detail.tasks} />
        <DispositionControl
          busy={busy}
          canRecordDisposition={canRecordDisposition}
          detail={detail}
          onDisposition={onDisposition}
          userId={userId}
        />
        {result.escalationReasons.length ? (
          <div className="reason-block">
            <span>Escalation evidence</span>
            <ul>
              {result.escalationReasons.map((reason) => (
                <li key={reason}>{humanize(reason)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="result-timestamp">
          Normalized {longDate(result.normalizedAt)}
        </p>
      </aside>
    </div>
  );
}

function ExceptionView({
  busy,
  canRecordDisposition,
  detail,
  onDisposition,
  userId,
}: DispositionActionProps) {
  return (
    <section className="exception-view">
      <p className="eyebrow">Human exception desk</p>
      <h3>{detail.tasks.length} next action{detail.tasks.length === 1 ? "" : "s"}</h3>
      {detail.tasks.length ? (
        <ol className="task-list">
          {detail.tasks.map((task, index) => (
            <li key={task.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{humanize(task.type)}</strong>
                <p>{task.reasonCodes.map(humanize).join(" · ")}</p>
              </div>
              <StatusLabel status={task.status} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-copy">This case has no queued human action.</p>
      )}
      {detail.result ? (
        <div className="exception-evidence">
          <span>Supporting result</span>
          <p>{detail.result.summary}</p>
        </div>
      ) : null}
      <DispositionControl
        busy={busy}
        canRecordDisposition={canRecordDisposition}
        detail={detail}
        onDisposition={onDisposition}
        userId={userId}
      />
    </section>
  );
}

function AuditView({
  casesHref,
  detail,
  loadState,
  loading,
  user,
}: {
  casesHref: string | undefined;
  detail: CaseDetail | null;
  loadState: DetailLoadState;
  loading: boolean;
  user: { id: string; name: string };
}) {
  if (loading && !detail) {
    return <PanelLoading label="Loading audit history" />;
  }

  if (
    !detail &&
    ["not_found", "access_denied", "error"].includes(loadState)
  ) {
    return <CaseUnavailable />;
  }

  if (!detail) {
    return (
      <section className="workspace-panel empty-workspace empty-state empty-state--neutral">
        <span aria-hidden="true" className="empty-index">
          FC / 02
        </span>
        <div aria-hidden="true" className="empty-state-icon">
          <svg fill="none" viewBox="0 0 24 24">
            <path d="M4.5 6.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-11Z" />
            <path d="M8.5 9.5h7M8.5 12.5h7M8.5 15.5h4" />
          </svg>
        </div>
        <p className="empty-state-eyebrow">Append-only audit</p>
        <h2>Select a case to inspect its audit history.</h2>
        <p className="empty-copy">
          Open a case from the queue to review its immutable event timeline.
        </p>
        {casesHref ? (
          <div className="empty-actions">
            <Link className="secondary-button" href={casesHref}>
              Browse closeout cases
            </Link>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="workspace-panel">
      <CaseHeading detail={detail} />
      <div className="audit-heading">
        <p className="eyebrow">Append-only evidence</p>
        <h3>{detail.audit.length} recorded transitions</h3>
      </div>
      <ol className="audit-timeline">
        {detail.audit.map((event, index) => (
          <li key={event.id}>
            <span className="audit-sequence">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <strong>{humanize(event.eventType)}</strong>
              <p>
                <span>{humanize(event.actorType)}</span> ·{" "}
                <strong>{auditActorLabel(event, user)}</strong>
              </p>
            </div>
            <time dateTime={event.occurredAt}>{longDate(event.occurredAt)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function auditActorLabel(
  event: CaseDetail["audit"][number],
  user: { id: string; name: string },
) {
  if (event.actorType === "operator") {
    return event.actorId === user.id ? user.name : "Authorized operator";
  }

  if (event.actorType === "provider") {
    return "Approved call provider";
  }

  return "FieldClose system";
}

function NextAction({ tasks }: { tasks: CaseDetail["tasks"] }) {
  const task = tasks.find((item) => item.status === "open") ?? tasks[0];

  return (
    <div className="next-action">
      <span>Human next action</span>
      <strong>{task ? humanize(task.type) : "Review complete result"}</strong>
      <p>
        {task
          ? task.reasonCodes.map(humanize).join(" · ")
          : "No automated operational decision is made."}
      </p>
    </div>
  );
}

type DispositionOption = {
  value: HumanDispositionOutcome;
  label: string;
  description: string;
  requiresNote: boolean;
};

function DispositionControl({
  busy,
  canRecordDisposition,
  detail,
  onDisposition,
  userId,
}: DispositionActionProps) {
  if (detail.disposition) {
    return (
      <RecordedDisposition
        detail={detail}
        disposition={detail.disposition}
        userId={userId}
      />
    );
  }

  const task = detail.tasks.find((item) => item.status === "open");

  if (!task) {
    return (
      <div className="disposition-panel disposition-panel-readonly">
        <span>Human disposition</span>
        <strong>No open task is available.</strong>
        <p>The case cannot be finalized until its current task is reconciled.</p>
      </div>
    );
  }

  if (!canRecordDisposition) {
    return (
      <div className="disposition-panel disposition-panel-readonly">
        <span>Human disposition</span>
        <strong>Owner or operator action required.</strong>
        <p>Auditors can review this evidence but cannot change the case.</p>
      </div>
    );
  }

  const options = dispositionOptions(task.type, detail.result?.route ?? null);

  return (
    <DispositionForm
      busy={busy}
      key={task.id}
      onDisposition={onDisposition}
      options={options}
      task={task}
    />
  );
}

function DispositionForm({
  busy,
  onDisposition,
  options,
  task,
}: {
  busy: boolean;
  onDisposition: DispositionActionProps["onDisposition"];
  options: DispositionOption[];
  task: CaseDetail["tasks"][number];
}) {
  const [outcome, setOutcome] = useState<HumanDispositionOutcome>(
    options[0]?.value ?? "no_further_automated_action",
  );
  const [resolutionNote, setResolutionNote] = useState("");
  const selected =
    options.find((option) => option.value === outcome) ?? options[0];
  const noteRequired = selected?.requiresNote ?? false;
  const normalizedNote = resolutionNote.trim();

  return (
    <form
      className="disposition-panel"
      onSubmit={(event) => {
        event.preventDefault();
        void onDisposition({
          taskId: task.id,
          outcome,
          resolutionNote: normalizedNote || null,
        });
      }}
    >
      <div className="disposition-panel-header">
        <span aria-hidden="true" className="disposition-mark">
          <svg fill="none" viewBox="0 0 24 24">
            <path d="M7.5 5.5h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" />
            <path d="m9.25 12.25 2 2 3.5-3.75" />
          </svg>
        </span>
        <span>Final human checkpoint</span>
      </div>
      <strong>Record the FieldClose disposition</strong>
      <p>
        This resolves the current FieldClose task only. It does not close an
        external work order, schedule a visit, or authorize invoicing.
      </p>
      <label htmlFor={`disposition-${task.id}`}>Decision</label>
      <select
        className="field-control"
        disabled={busy}
        id={`disposition-${task.id}`}
        onChange={(event) =>
          setOutcome(event.target.value as HumanDispositionOutcome)
        }
        value={outcome}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {selected ? <small>{selected.description}</small> : null}
      <label htmlFor={`disposition-note-${task.id}`}>
        Resolution note{noteRequired ? " (required)" : " (optional)"}
      </label>
      <textarea
        className="field-control"
        disabled={busy}
        id={`disposition-note-${task.id}`}
        maxLength={1_000}
        onChange={(event) => setResolutionNote(event.target.value)}
        placeholder={
          noteRequired
            ? "Record the human handoff without private contact data."
            : "Add a bounded internal note if needed."
        }
        rows={3}
        value={resolutionNote}
      />
      <button
        className="primary-button full-width"
        disabled={busy || (noteRequired && !normalizedNote)}
        type="submit"
      >
        {busy ? "Recording disposition…" : "Record human disposition"}
      </button>
    </form>
  );
}

function RecordedDisposition({
  detail,
  disposition,
  userId,
}: {
  detail: CaseDetail;
  disposition: NonNullable<CaseDetail["disposition"]>;
  userId: string;
}) {
  const task = detail.tasks.find((item) => item.id === disposition.taskId);

  return (
    <div className="disposition-panel disposition-panel-complete" role="status">
      <span>Human disposition recorded</span>
      <strong>{dispositionLabel(disposition.outcome)}</strong>
      <p>
        FieldClose case closed by{" "}
        {disposition.recordedBy === userId ? "you" : "an authorized operator"}
        {" · "}
        {longDate(disposition.recordedAt)}
      </p>
      {disposition.resolutionNote ? (
        <blockquote>{disposition.resolutionNote}</blockquote>
      ) : null}
      <div className="disposition-final-state">
        <StatusLabel status={detail.case.status} />
        {task ? <StatusLabel status={task.status} /> : null}
      </div>
      <small>
        No external work order, appointment, invoice, or return visit was
        changed by this action.
      </small>
    </div>
  );
}

function dispositionOptions(taskType: string, resultRoute: string | null) {
  const options: DispositionOption[] = [];

  if (
    taskType === "closeout_review" &&
    resultRoute === "ready_for_closeout_review"
  ) {
    options.push({
      value: "closeout_accepted",
      label: "Accept closeout review",
      description:
        "Record that the operator accepts the FieldClose recommendation.",
      requiresNote: false,
    });
  }

  if (
    taskType === "return_visit_review" &&
    resultRoute === "return_visit_review"
  ) {
    options.push({
      value: "return_visit_handoff",
      label: "Record return-visit handoff",
      description:
        "Record human ownership without confirming a date or arrival time.",
      requiresNote: true,
    });
  }

  if (taskType !== "closeout_review") {
    options.push({
      value: "manual_follow_up_handoff",
      label: "Record manual follow-up handoff",
      description:
        "Record which human process now owns this exception; FieldClose does not perform it.",
      requiresNote: true,
    });
  }

  options.push({
    value: "no_further_automated_action",
    label: "End automated follow-up",
    description:
      "Close this FieldClose workflow without another automated attempt.",
    requiresNote: false,
  });

  return options;
}

function dispositionLabel(outcome: HumanDispositionOutcome) {
  const labels: Record<HumanDispositionOutcome, string> = {
    closeout_accepted: "Closeout review accepted",
    return_visit_handoff: "Return-visit handoff recorded",
    manual_follow_up_handoff: "Manual follow-up handoff recorded",
    no_further_automated_action: "No further automated action",
  };

  return labels[outcome];
}

function ResultMeasure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusLabel({ status }: { status: string }) {
  const tone = ["completed", "closed", "resolved"].includes(status)
    ? "safe"
    : ["needs_attention", "failed", "open"].includes(status)
      ? "attention"
      : "neutral";

  return (
    <span className={`status-label status-${tone}`}>{humanize(status)}</span>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen" id="main-content">
      <BrandMark labelled />
      <p>Verifying secure session…</p>
    </main>
  );
}

function WorkspaceLoading() {
  return (
    <div className="workspace-loading">
      <div />
      <p>Establishing your isolated demo workspace…</p>
    </div>
  );
}

function WorkspaceUnavailable() {
  return (
    <section className="workspace-panel empty-workspace empty-state empty-state--attention workspace-unavailable">
      <span aria-hidden="true" className="empty-index">
        FC / 00
      </span>
      <div aria-hidden="true" className="empty-state-icon">
        <svg fill="none" viewBox="0 0 24 24">
          <path d="M12 4.25 20.25 19H3.75L12 4.25Z" />
          <path d="M12 9.75v4.5M12 17.25h.01" />
        </svg>
      </div>
      <p className="empty-state-eyebrow">Workspace access</p>
      <h2>Workspace unavailable</h2>
      <p className="empty-copy">
        Choose an available workspace or return to the public product page. No
        record details were disclosed.
      </p>
      <div className="empty-actions">
        <Link className="primary-button" href="/workspace">
          Open an available workspace
        </Link>
        <Link className="secondary-button" href="/">
          Product home
        </Link>
      </div>
    </section>
  );
}

function CaseCreationUnavailable({
  showLocalSetupHint,
}: {
  showLocalSetupHint: boolean;
}) {
  return (
    <section className="workspace-panel empty-workspace empty-state empty-state--attention">
      <span aria-hidden="true" className="empty-index">
        FC / CFG
      </span>
      <div aria-hidden="true" className="empty-state-icon">
        <svg fill="none" viewBox="0 0 24 24">
          <path d="M14.5 10.5h4l1.5 1.5v5a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-5l1.5-1.5h1Z" />
          <circle cx="11.75" cy="14.5" r="0.75" />
          <path d="M12.5 14.5v-2a1.75 1.75 0 0 0-3.5 0v2" />
        </svg>
      </div>
      <p className="empty-state-eyebrow">Configuration required</p>
      <h2>Case protection setup required</h2>
      <p className="empty-copy">
        Contact data cannot be accepted until separate encryption and lookup
        keys are configured.
        {showLocalSetupHint
          ? " Run pnpm setup:local-demo, then restart the local server."
          : " Contact the FieldClose operator."}
      </p>
    </section>
  );
}

function CaseUnavailable() {
  return (
    <section className="workspace-panel empty-workspace empty-state empty-state--attention case-unavailable">
      <span aria-hidden="true" className="empty-index">
        FC / 04
      </span>
      <div aria-hidden="true" className="empty-state-icon">
        <svg fill="none" viewBox="0 0 24 24">
          <path d="M6.5 4.5h7L18 9v10a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" />
          <path d="M13 4.5V9h4.5" />
          <path d="m9.25 15.5 5.5-5.5M14.75 15.5l-5.5-5.5" />
        </svg>
      </div>
      <p className="empty-state-eyebrow">Record access</p>
      <h2>Case unavailable</h2>
      <p className="empty-copy">
        This record could not be opened. It may not exist or may be outside your
        workspace access.
      </p>
    </section>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <section className="workspace-panel panel-loading">
      <span aria-hidden="true" />
      <p>{label}…</p>
    </section>
  );
}

type ApiIssue = { path: string; message: string };

class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly issues: ApiIssue[] = [],
  ) {
    super(code);
    this.name = "ApiError";
  }
}

async function requestJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string; issues?: ApiIssue[] } }
    | T
    | null;

  if (!response.ok) {
    const code =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error?.code
        ? payload.error.code
        : "request_failed";
    const issues =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      Array.isArray(payload.error?.issues)
        ? payload.error.issues
        : [];
    throw new ApiError(code, issues);
  }

  return payload as T;
}

function newCaseErrors(error: unknown): NewCaseFieldErrors {
  if (!(error instanceof ApiError)) {
    return {};
  }

  const phoneIssue = error.issues.find((issue) =>
    ["contact.phoneE164", "case.contact.phoneE164"].includes(issue.path),
  );

  return phoneIssue
    ? { "contact.phoneE164": phoneIssue.message }
    : {};
}

function detailStateForError(error: unknown): DetailLoadState {
  if (!(error instanceof ApiError)) {
    return "error";
  }

  if (error.code === "case_not_found") {
    return "not_found";
  }

  if (
    ["workspace_access_denied", "case_access_denied"].includes(error.code)
  ) {
    return "access_denied";
  }

  return "error";
}

function readableError(error: unknown) {
  const code = error instanceof ApiError ? error.code : "request_failed";
  const messages: Record<string, string> = {
    phone_protection_not_configured:
      "The server needs its demo encryption and lookup keys before cases can be used.",
    phone_protection_configuration_invalid:
      "The server phone-protection keys are invalid or reused.",
    contact_do_not_call:
      "This contact requested no further automated calls. A new attempt is blocked.",
    stale_case_version:
      "The case changed after this view loaded. Review the current state before acting.",
    brief_hash_mismatch:
      "The exact brief changed after review. Approval was not recorded.",
    attempt_already_exists:
      "This case already has an attempt that requires human review.",
    authentication_required: "Your session expired. Sign in again to continue.",
    case_not_found:
      "This case is unavailable or you do not have permission to open it.",
    workspace_access_denied:
      "This case is unavailable or you do not have permission to open it.",
    operator_role_forbidden:
      "This workspace role can review the case but cannot record this action.",
    human_disposition_conflict:
      "A different final disposition is already recorded. The current case state was reloaded.",
    disposition_task_mismatch:
      "The human task changed before this decision was recorded. Review the current task.",
    disposition_outcome_not_allowed:
      "That decision is not permitted for the current result and human task.",
    case_not_ready_for_disposition:
      "This case does not yet have a human-review outcome to finalize.",
    sign_out_failed: "Sign out could not be completed. Try again.",
    invalid_request: "Check the highlighted case details and try again.",
    request_failed: "The server could not complete the request. No call was placed.",
  };

  return messages[code] ?? `The request stopped safely (${humanize(code)}).`;
}

function createCallingWindow(timezone: string) {
  const evaluatedAt = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(evaluatedAt);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;

  return {
    timezone,
    startLocal: `${localDate}T09:00:00`,
    endLocal: `${localDate}T17:00:00`,
    evaluatedAt: evaluatedAt.toISOString(),
  };
}

function workspaceMode(workspaceValue: Workspace | null): "fake" | "live" {
  return workspaceValue?.kind === "protected" &&
    workspaceValue.provider === "call_e" &&
    workspaceValue.liveCallsAllowed
    ? "live"
    : "fake";
}

function viewHeading(view: ViewName) {
  if (view === "exceptions") {
    return "Exceptions needing a person";
  }

  if (view === "audit") {
    return "Decision and provider history";
  }

  return "Closeout cases";
}

function routeLabel(route: string) {
  const labels: Record<string, string> = {
    ready_for_closeout_review: "Ready for human closeout review",
    return_visit_review: "Review a possible return visit",
    human_follow_up: "Human follow-up required",
    unreachable: "Contact unreachable",
    failed: "Provider failure review",
  };

  return labels[route] ?? humanize(route);
}

function caseRequiredAction(detail: CaseDetail) {
  if (detail.disposition) {
    return dispositionLabel(detail.disposition.outcome);
  }

  if (!detail.attempt) {
    return "Review and approve brief";
  }

  if (
    detail.attempt.creationDisposition ===
    "ambiguous_requires_reconciliation"
  ) {
    return "Resolve provider creation state";
  }

  if (!detail.result) {
    return detail.attempt.mode === "live"
      ? detail.attempt.providerCallId
        ? "Wait for verified result"
        : "Run final call preflight"
      : "Run approved simulation";
  }

  return detail.tasks[0]
    ? humanize(detail.tasks[0].type)
    : routeLabel(detail.result.route);
}

function answerLabel(answer: AnswerValue) {
  return `${humanize(answer.value)} · ${humanize(answer.confidence)} confidence`;
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replaceAll(".", " · ");
}

function initials(name: string) {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function longDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
