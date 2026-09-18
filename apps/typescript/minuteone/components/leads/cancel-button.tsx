"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Cancels a still-"pending" lead before the worker ever dispatches a call for it. */
export function CancelButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleCancel() {
    if (!confirm("Cancel this lead? It will never be called.")) return;
    setPending(true);
    try {
      await fetch(`/api/leads/${leadId}/cancel`, { method: "POST" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCancel} disabled={pending}>
      {pending ? "Cancelling…" : "Cancel"}
    </Button>
  );
}
