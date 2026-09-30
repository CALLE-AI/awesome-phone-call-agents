"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface WorkflowOption {
  id: string;
  name?: string;
  goal: string;
}

const WORKFLOW_LABEL_LIMIT = 48;

function workflowLabel(workflow: WorkflowOption): string {
  const label = workflow.name ?? workflow.goal;
  if (label.length <= WORKFLOW_LABEL_LIMIT) return label;
  return `${label.slice(0, WORKFLOW_LABEL_LIMIT - 1).trimEnd()}…`;
}

function errorMessage(value: unknown): string {
  if (typeof value !== "object" || value === null) return "The request failed.";
  const body = value as { error?: unknown; issues?: unknown };
  const summary = typeof body.error === "string" ? body.error : "The request failed.";
  const issues = Array.isArray(body.issues)
    ? body.issues.filter((item): item is string => typeof item === "string")
    : [];
  return issues.length ? `${summary}: ${issues.join("; ")}` : summary;
}

export default function NewCampaignForm({
  workflows,
  initialWorkflowId,
}: {
  workflows: WorkflowOption[];
  initialWorkflowId: string;
}) {
  const router = useRouter();
  const [workflowId, setWorkflowId] = useState(initialWorkflowId);
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workflowMenuRef = useRef<HTMLDivElement>(null);
  const selectedWorkflow =
    workflows.find((workflow) => workflow.id === workflowId) ?? workflows[0];

  useEffect(() => {
    if (!workflowMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!workflowMenuRef.current?.contains(event.target as Node)) {
        setWorkflowMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkflowMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [workflowMenuOpen]);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workflowId,
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(body));
      const campaignId = (body as { campaignId?: unknown }).campaignId;
      if (typeof campaignId !== "string") {
        throw new Error("The response did not include a campaign id.");
      }
      router.push(`/campaigns/${campaignId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Campaign could not be created.");
      setPending(false);
    }
  };

  return (
    <div className="mt-8 w-full">
      <div className="block text-xs text-bone/55">
        <span
          id="workflow-picker-label"
          className="mb-2 block font-extrabold uppercase tracking-[.1em] text-bone/65"
        >
          Workflow
        </span>
        <div ref={workflowMenuRef} className="relative w-[360px] max-w-full">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={workflowMenuOpen}
            aria-labelledby="workflow-picker-label workflow-picker-value"
            onClick={() => setWorkflowMenuOpen((open) => !open)}
            className="grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_36px] overflow-hidden border border-bone/[.26] bg-panel text-left text-[13px] font-extrabold text-bone outline-none transition-colors focus:border-flame"
          >
            <span
              id="workflow-picker-value"
              className="block min-w-0 max-w-full truncate py-2.5 pl-3.5 pr-2"
            >
              {workflowLabel(selectedWorkflow)}
            </span>
            <span
              aria-hidden="true"
              className="grid place-items-center border-l border-bone/[.18] text-[11px] text-ember"
            >
              {workflowMenuOpen ? "▲" : "▼"}
            </span>
          </button>

          {workflowMenuOpen ? (
            <div
              role="listbox"
              aria-labelledby="workflow-picker-label"
              className="veyra-dropdown-scrollbar absolute left-0 top-[calc(100%+4px)] z-20 max-h-60 w-full max-w-full overscroll-contain overflow-x-hidden overflow-y-auto border border-bone/[.26] bg-panel shadow-[0_12px_30px_rgba(0,0,0,.4)]"
            >
              {workflows.map((workflow) => {
                const selected = workflow.id === workflowId;
                return (
                  <button
                    key={workflow.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    title={workflow.name ?? workflow.goal}
                    onClick={() => {
                      setWorkflowId(workflow.id);
                      setWorkflowMenuOpen(false);
                    }}
                    className={`block w-full min-w-0 cursor-pointer overflow-hidden border-0 border-b border-bone/[.14] px-3.5 py-2.5 text-left text-[13px] last:border-b-0 ${
                      selected
                        ? "bg-flame text-ink"
                        : "bg-panel text-bone/75 hover:bg-bone/[.07] hover:text-bone"
                    }`}
                  >
                    <span className="block min-w-0 max-w-full truncate">
                      {workflowLabel(workflow)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <label className="mt-5 block text-xs text-bone/55">
        <span className="mb-2 block font-extrabold uppercase tracking-[.1em] text-bone/65">
          Campaign name (optional)
        </span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          placeholder="Defaults to the workflow goal"
          className="w-full border border-bone/[.26] bg-panel px-3.5 py-3 text-sm text-bone outline-none placeholder:text-bone/25"
        />
      </label>

      {error ? (
        <div
          role="alert"
          className="mt-5 border border-red-400/50 bg-red-950/30 p-3 text-sm text-red-200"
        >
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-6 inline-flex cursor-pointer items-center gap-2.5 border-0 bg-flame px-5 py-[13px] text-sm font-extrabold text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Creating campaign…" : "Create campaign"}
      </button>
    </div>
  );
}
