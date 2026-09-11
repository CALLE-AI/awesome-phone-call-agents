"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function WorkflowDeleteButton({
  workflowId,
  redirectTo,
}: {
  workflowId: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    const confirmed = window.confirm(
      "Delete this workflow? Its campaigns, contacts, call results, and transcripts will also be permanently deleted. This cannot be undone.",
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, { method: "DELETE" });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "Workflow could not be deleted";
        throw new Error(message);
      }

      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workflow could not be deleted");
      setDeleting(false);
    }
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        className="cursor-pointer border border-red-300/35 bg-transparent px-3.5 py-[9px] text-[12.5px] font-extrabold text-red-200 hover:bg-red-950/35 disabled:cursor-wait disabled:opacity-50"
      >
        {deleting ? "Deleting…" : "Delete"}
      </button>
      {error ? (
        <span role="alert" className="max-w-56 text-right text-[11px] leading-4 text-red-200">
          {error}
        </span>
      ) : null}
    </span>
  );
}
