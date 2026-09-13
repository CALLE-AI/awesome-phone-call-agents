import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import StepHeader from "@/components/StepHeader";
import WorkflowEditor from "@/components/WorkflowEditor";
import { workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { getSessionUser } from "@/lib/supabase/auth";
import type { Workflow } from "@/types/workflow";

/**
 * The workflow just produced by POST /api/workflows/generate (or any workflow the
 * signed-in user owns). RLS scopes the query to that user (enforced through
 * withRLS() — see lib/db/with-rls.ts), so a row belonging to someone else and a row
 * that never existed both resolve the same way here: not found.
 */
export default async function WorkflowByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) redirect(`/auth/login?next=/workflow/${id}`);

  const [row] = await withRLS(user.id, (tx) =>
    tx.select({ schema: workflows.schema }).from(workflows).where(eq(workflows.id, id)).limit(1),
  );

  if (!row) notFound();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink">
      <StepHeader current="workflow" />
      <WorkflowEditor workflow={row.schema as Workflow} />
    </div>
  );
}
