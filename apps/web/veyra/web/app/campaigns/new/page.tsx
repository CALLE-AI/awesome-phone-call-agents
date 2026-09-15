import { desc } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import NewCampaignForm from "@/components/NewCampaignForm";
import StepHeader from "@/components/StepHeader";
import { workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { getSessionUser } from "@/lib/supabase/auth";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ workflowId?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login?next=/campaigns/new");

  const { workflowId } = await searchParams;

  const rows = await withRLS(user.id, (tx) =>
    tx
      .select({ id: workflows.id, goal: workflows.goal, schema: workflows.schema })
      .from(workflows)
      .orderBy(desc(workflows.updatedAt)),
  );
  const workflowOptions = rows.map((row) => {
    const workflow = row.schema as { name?: unknown };
    return {
      id: row.id,
      goal: row.goal,
      ...(typeof workflow.name === "string" && workflow.name.trim()
        ? { name: workflow.name }
        : {}),
    };
  });

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <StepHeader current="campaign" />
      <main className="mx-auto flex w-full max-w-[616px] flex-1 flex-col items-start px-6 py-14 md:px-12 md:py-20">
        <div className="text-[10.5px] uppercase tracking-[.14em] text-bone/45">
          New campaign
        </div>
        <h1 className="mt-3 text-4xl font-extrabold text-bone">
          Choose a workflow to launch.
        </h1>

        {rows.length === 0 ? (
          <>
            <p className="mt-4 max-w-lg text-sm leading-6 text-bone/55">
              You don&apos;t have any generated workflows yet. Describe a calling process
              on the Prompt step first.
            </p>
            <Link
              href="/"
              className="mt-6 bg-flame px-5 py-3 text-sm font-extrabold text-ink no-underline"
            >
              Go to Prompt
            </Link>
          </>
        ) : (
          <>
            <p className="mt-4 max-w-lg text-sm leading-6 text-bone/55">
              Pick a workflow and name the campaign. You&apos;ll add contacts and preview
              every call on the next step.
            </p>
            <NewCampaignForm
              workflows={workflowOptions}
              initialWorkflowId={
                workflowId && workflowOptions.some((row) => row.id === workflowId)
                  ? workflowId
                  : workflowOptions[0].id
              }
            />
          </>
        )}
      </main>
    </div>
  );
}
