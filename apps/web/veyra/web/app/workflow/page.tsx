import { desc } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import StepHeader from "@/components/StepHeader";
import WorkflowDeleteButton from "@/components/WorkflowDeleteButton";
import { workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { getSessionUser } from "@/lib/supabase/auth";
import type { Workflow } from "@/types/workflow";

const EYEBROW = "text-[10.5px] uppercase tracking-[.14em] text-bone/45";

function formatUpdated(date: Date | null): string {
  if (!date) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.round(hours / 24)}d ago`;
}

/**
 * "02 Workflow" without a specific id: the signed-in user's own generated workflows,
 * not a single hardcoded one. RLS (`workflows_select_own`, via withRLS()) is what scopes
 * this to the caller — there is no `.where(eq(workflows.userId, ...))` here because none
 * is needed for the enforcement, only for a query that happens to want "mine".
 */
export default async function WorkflowListPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login?next=/workflow");

  const rows = await withRLS(user.id, (tx) =>
    tx
      .select({
        id: workflows.id,
        goal: workflows.goal,
        schema: workflows.schema,
        updatedAt: workflows.updatedAt,
      })
      .from(workflows)
      .orderBy(desc(workflows.updatedAt)),
  );

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <StepHeader current="workflow" />

      <main className="flex-1 px-6 pb-[72px] md:px-12">
        <div className="mx-auto w-full max-w-210">
          <div className="flex flex-wrap items-end justify-between gap-6 border-b-2 border-bone/[.26] pb-[22px] pt-[34px]">
            <div>
              <div className={`${EYEBROW} mb-[5px]`}>Your workflows</div>
              <h1 className="text-3xl font-extrabold tracking-[-.01em] text-bone">
                {rows.length} generated workflow{rows.length === 1 ? "" : "s"}
              </h1>
            </div>
            <Link
              href="/"
              className="inline-flex flex-none items-center gap-[9px] whitespace-nowrap bg-flame px-[17px] py-3 text-[13.5px] font-extrabold text-ink no-underline"
            >
              New workflow from prompt
            </Link>
          </div>

          {rows.length === 0 ? (
            <div className="flex flex-col items-start gap-4 py-16">
              <p className="max-w-md text-[14px] leading-[1.55] text-bone/55">
                No workflows yet. Describe a calling process on the Prompt step and Veyra
                will generate an editable one here.
              </p>
              <Link
                href="/"
                className="border border-bone/[.26] px-3.5 py-[9px] text-[12.5px] font-extrabold text-bone no-underline"
              >
                Go to Prompt
              </Link>
            </div>
          ) : (
            <div className="flex flex-col border-t border-bone/[.18]">
              {rows.map((row) => {
                const workflow = row.schema as Workflow;
                return (
                  <div
                    key={row.id}
                    className="flex items-center gap-4 border-b border-bone/[.14] py-4 hover:bg-bone/[.03]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <span className="flex-none text-[10px] uppercase tracking-[.14em] text-ember">
                          {workflow.nodes?.length ?? 0} nodes
                        </span>
                        <Link
                          href={`/workflow/${row.id}`}
                          className="truncate text-[15px] font-extrabold tracking-[-.01em] text-bone no-underline hover:text-blush"
                        >
                          {workflow.name ?? row.goal}
                        </Link>
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-4">
                      <span className="hidden whitespace-nowrap text-[11px] text-bone/35 sm:inline">
                        {formatUpdated(row.updatedAt)}
                      </span>
                      <Link
                        href={`/workflow/${row.id}`}
                        className="whitespace-nowrap text-[12px] font-extrabold text-bone/70 underline decoration-bone/25 underline-offset-4"
                      >
                        Open editor
                      </Link>
                      <WorkflowDeleteButton workflowId={row.id} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
