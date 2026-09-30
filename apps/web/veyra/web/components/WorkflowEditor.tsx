"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import NodeInspector from "@/components/NodeInspector";
import NodeTable from "@/components/NodeTable";
import WorkflowGraph from "@/components/WorkflowGraph";
import WorkflowDeleteButton from "@/components/WorkflowDeleteButton";
import type { Workflow, WorkflowNode } from "@/types/workflow";

type View = "graph" | "table";

const TAB =
  "flex-none cursor-pointer whitespace-nowrap border-0 px-[15px] py-2 text-[12.5px] font-extrabold";

export default function WorkflowEditor({
  workflow,
  /** True when the workflow has just been generated and not yet compiled. */
  initiallyDirty = true,
}: {
  workflow: Workflow;
  initiallyDirty?: boolean;
}) {
  const [nodes, setNodes] = useState(workflow.nodes);
  const [view, setView] = useState<View>("graph");
  const [selectedId, setSelectedId] = useState<string | null>("n3");
  const [dirty, setDirty] = useState(initiallyDirty);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const router = useRouter();

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const outgoing = workflow.edges.filter((e) => e.from === selectedId).length;

  /** Any edit to node content puts the workflow out of sync with the last compile. */
  const editNode = (id: string, patch: Partial<WorkflowNode>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    setDirty(true);
  };

  // Moving a node is layout, not content — it does not invalidate the compile.
  const moveNode = (id: string, x: number, y: number) =>
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));

  const compile = async () => {
    setCompiling(true);
    setCompileError(null);
    const currentWorkflow: Workflow = { ...workflow, nodes };

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/compile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflow: currentWorkflow }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const errorBody = body as { error?: unknown; detail?: unknown; issues?: unknown };
        const summary =
          typeof errorBody.error === "string" ? errorBody.error : "Workflow compilation failed";
        const detail =
          typeof errorBody.detail === "string"
            ? errorBody.detail
            : Array.isArray(errorBody.issues)
              ? errorBody.issues.filter((issue) => typeof issue === "string").join("; ")
              : "";
        throw new Error(detail ? `${summary}: ${detail}` : summary);
      }

      const campaignId = (body as { campaignId?: unknown }).campaignId;
      if (typeof campaignId !== "string") {
        throw new Error("The compiler response did not include a campaign id.");
      }
      setDirty(false);
      router.push(`/campaigns/${encodeURIComponent(campaignId)}`);
    } catch (error) {
      setCompileError(error instanceof Error ? error.message : "Workflow compilation failed");
      setCompiling(false);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-5 border-b border-bone/[.18] px-[22px] py-3.5">
        <div className="min-w-[220px] flex-1">
          <div className="mb-[3px] text-[10px] uppercase tracking-[.16em] text-ember">
            Workflow
          </div>
          <div className="truncate text-[14.5px] font-extrabold text-bone/90">
            {workflow.name ?? workflow.goal}
          </div>
          {workflow.name ? (
            <div className="mt-1 truncate text-[11px] text-bone/40">{workflow.goal}</div>
          ) : null}
        </div>

        <div className="flex border border-bone/[.26]">
          {(["graph", "table"] as const).map((v, i) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`${TAB} ${i === 0 ? "border-r border-bone/[.26]" : ""} ${
                view === v ? "bg-flame text-ink" : "bg-transparent text-bone"
              }`}
            >
              {v === "graph" ? "Graph" : "Table"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`inline-flex flex-none items-center gap-[7px] whitespace-nowrap text-[11px] uppercase tracking-[.08em] ${
              dirty ? "text-blush" : "text-bone/40"
            }`}
          >
            <span className="inline-block size-1.5 bg-current" />
            {dirty ? "Edited since last compile" : "Saved and compiled"}
          </span>
          <button
            type="button"
            onClick={compile}
            disabled={compiling}
            className="inline-flex flex-none cursor-pointer items-center gap-[9px] whitespace-nowrap border-0 bg-flame px-4 py-[11px] text-[13.5px] font-extrabold text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {compiling ? "Compiling…" : "Compile to Call"}
          </button>
          <WorkflowDeleteButton workflowId={workflow.id} redirectTo="/profile" />
        </div>
      </div>

      {compileError ? (
        <div role="alert" className="border-b border-red-400/40 bg-red-950/30 px-[22px] py-3 text-sm text-red-200">
          {compileError}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {view === "graph" ? (
          <WorkflowGraph
            nodes={nodes}
            edges={workflow.edges}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMoveNode={moveNode}
          />
        ) : (
          <NodeTable nodes={nodes} onSelect={setSelectedId} />
        )}

        <NodeInspector
          node={selected}
          outgoing={outgoing}
          onClose={() => setSelectedId(null)}
          onChange={(patch) => selected && editNode(selected.id, patch)}
        />
      </div>
    </main>
  );
}
