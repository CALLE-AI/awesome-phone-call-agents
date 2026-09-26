import { desc } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import StepHeader from "@/components/StepHeader";
import ProfileEditDialog from "@/components/ProfileEditDialog";
import WorkflowDeleteButton from "@/components/WorkflowDeleteButton";
import { hasLiveOperatorRole } from "@/lib/auth/live-policy";
import { callResults, campaigns, workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { initialsFor } from "@/lib/initials";
import { getSessionUser } from "@/lib/supabase/auth";
import type { Workflow } from "@/types/workflow";

const EYEBROW = "text-[10.5px] uppercase tracking-[.14em] text-bone/45";

type SavedWorkflow = {
  id: string;
  name: string;
  goal: string;
  steps: number;
  compiledCampaignId: string | null;
  calls: number;
  qualificationRate: string;
  updatedAt: Date | null;
};

function formatUpdated(date: Date | null): string {
  if (!date) return "";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `Updated ${days}d ago`;
  return `Updated ${date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })}`;
}

function Stat({
  label,
  value,
  sub,
  last = false,
}: {
  label: string;
  value: string;
  sub: string;
  last?: boolean;
}) {
  return (
    <div className={`px-[34px] py-7 ${last ? "" : "border-r border-bone/[.18]"}`}>
      <div className={`${EYEBROW} mb-2.5`}>{label}</div>
      <div className="text-[38px] font-extrabold leading-none tracking-[-.03em] text-bone">
        {value}
      </div>
      <div className="mt-2 text-xs text-bone/40">{sub}</div>
    </div>
  );
}

function WorkflowCard({ workflow: w }: { workflow: SavedWorkflow }) {
  const compiled = Boolean(w.compiledCampaignId);

  return (
    <div className="flex flex-col gap-3.5 border-b border-r border-bone/[.14] px-[22px] pb-[18px] pt-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[.14em] text-ember">
          {w.steps} conversation node{w.steps === 1 ? "" : "s"}
        </div>
        <span
          className={`flex-none px-2 py-1 text-[10px] font-extrabold uppercase tracking-[.08em] ${
            compiled
              ? "bg-flame/[.14] text-blush"
              : "border border-bone/[.22] text-bone/45"
          }`}
        >
          {compiled ? "Compiled" : "Draft"}
        </span>
      </div>

      <p className="text-[15px] font-extrabold leading-[1.45] tracking-[-.01em] text-bone">
        {w.name}
      </p>
      {w.name !== w.goal ? <p className="text-xs leading-5 text-bone/45">{w.goal}</p> : null}

      <div className="grid grid-cols-3 gap-2.5 border-t border-bone/[.14] pt-3 text-[11px] text-bone">
        {[
          ["Steps", String(w.steps)],
          ["Live calls", w.calls.toLocaleString("en-IN")],
          ["Qualified", w.qualificationRate],
        ].map(([label, value]) => (
          <span key={label}>
            <span className="mb-[3px] block text-[9.5px] uppercase tracking-[.08em] text-bone/40">
              {label}
            </span>
            <span className="font-extrabold">{value}</span>
          </span>
        ))}
      </div>

      <div className="mt-auto flex flex-wrap items-start gap-2">
        {w.compiledCampaignId ? (
          <Link
            href={`/campaigns/${w.compiledCampaignId}`}
            className="bg-flame px-3.5 py-[9px] text-[12.5px] font-extrabold text-ink no-underline"
          >
            Prepare for CALL-E
          </Link>
        ) : (
          <span
            className="border border-bone/[.18] px-3.5 py-[9px] text-[12.5px] font-extrabold text-bone/30"
            aria-disabled="true"
          >
            Prepare for CALL-E
          </span>
        )}
        <Link
          href={`/workflow/${w.id}`}
          className="border border-bone/[.26] px-3.5 py-[9px] text-[12.5px] font-extrabold text-bone no-underline"
        >
          Open editor
        </Link>
        <WorkflowDeleteButton workflowId={w.id} />
        <span className="w-full text-[11px] text-bone/35">{formatUpdated(w.updatedAt)}</span>
      </div>
    </div>
  );
}

export default async function ProfilePage() {
  const user = await getSessionUser();

  // The middleware already guards /profile, so this only fires if a request somehow
  // reaches the page without a session. Cheap, and it keeps `user` non-null below.
  if (!user) redirect("/auth/login?next=/profile");

  const data = await withRLS(user.id, async (tx) => {
    const workflowRows = await tx
      .select({
        id: workflows.id,
        goal: workflows.goal,
        schema: workflows.schema,
        updatedAt: workflows.updatedAt,
      })
      .from(workflows)
      .orderBy(desc(workflows.updatedAt));
    const campaignRows = await tx
      .select({
        id: campaigns.id,
        workflowId: campaigns.workflowId,
        compiledRequest: campaigns.compiledRequest,
        status: campaigns.status,
        createdAt: campaigns.createdAt,
      })
      .from(campaigns)
      .orderBy(desc(campaigns.createdAt));
    const resultRows = hasLiveOperatorRole(user.role)
      ? await tx
          .select({
            campaignId: callResults.campaignId,
            calleCallId: callResults.calleCallId,
            qualified: callResults.qualified,
            status: callResults.status,
          })
          .from(callResults)
      : [];

    return { workflowRows, campaignRows, resultRows };
  });

  const campaignById = new Map(data.campaignRows.map((campaign) => [campaign.id, campaign]));
  const liveResults = data.resultRows.filter(
    (result) => result.calleCallId && !result.calleCallId.startsWith("fake_"),
  );
  const liveCampaignIds = new Set(
    liveResults.flatMap((result) => (result.campaignId ? [result.campaignId] : [])),
  );
  const completedLiveCalls = liveResults.filter((result) => result.status === "completed").length;
  const completedLiveCampaigns = data.campaignRows.filter(
    (campaign) => liveCampaignIds.has(campaign.id) && campaign.status === "completed",
  ).length;

  const savedWorkflows: SavedWorkflow[] = data.workflowRows.map((row) => {
    const workflowCampaigns = data.campaignRows.filter(
      (campaign) => campaign.workflowId === row.id,
    );
    const compiledCampaign = workflowCampaigns.find((campaign) => campaign.compiledRequest !== null);
    const workflowResults = liveResults.filter(
      (result) =>
        result.campaignId !== null && campaignById.get(result.campaignId)?.workflowId === row.id,
    );
    const measuredResults = workflowResults.filter((result) => result.qualified !== null);
    const qualifiedResults = measuredResults.filter((result) => result.qualified).length;
    const workflow = row.schema as Partial<Workflow>;

    return {
      id: row.id,
      name: workflow.name?.trim() || row.goal,
      goal: row.goal,
      steps: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
      compiledCampaignId: compiledCampaign?.id ?? null,
      calls: workflowResults.length,
      qualificationRate:
        measuredResults.length === 0
          ? "—"
          : `${Math.round((qualifiedResults / measuredResults.length) * 100)}%`,
      updatedAt: row.updatedAt,
    };
  });
  const compiledCount = savedWorkflows.filter((workflow) => workflow.compiledCampaignId).length;
  const draftCount = savedWorkflows.length - compiledCount;

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <StepHeader current="profile" />

      <main className="flex-1 pb-[72px]">
        <div className="flex flex-wrap items-end justify-between gap-6 border-b-2 border-bone/[.26] px-[34px] pb-[22px] pt-[34px]">
          <div className="flex items-end gap-[18px]">
            <span
              className="grid size-16 place-items-center border border-bone/[.26] bg-bone/10 bg-cover bg-center text-xl font-extrabold tracking-[.04em] text-bone"
              style={user.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}
            >
              {user.avatarUrl ? null : initialsFor(user.fullName, user.email)}
            </span>
            <div>
              <div className={`${EYEBROW} mb-[5px]`}>Account</div>
              <h1 className="mb-1 text-3xl font-extrabold tracking-[-.01em] text-bone">
                {user.fullName ?? user.email}
              </h1>
              <div className="text-[13px] text-bone/50">
                {user.companyName ? `${user.companyName} · ` : ""}
                {user.email}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ProfileEditDialog
              fullName={user.fullName}
              companyName={user.companyName}
              email={user.email}
              avatarUrl={user.avatarUrl}
              initials={initialsFor(user.fullName, user.email)}
            />
            <Link
              href="/"
              className="inline-flex flex-none items-center gap-[9px] whitespace-nowrap bg-flame px-[17px] py-3 text-[13.5px] font-extrabold text-ink no-underline"
            >
              New workflow from prompt
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 border-b-2 border-bone/[.26] sm:grid-cols-3">
          <Stat
            label="Saved workflows"
            value={String(savedWorkflows.length)}
            sub={`${compiledCount} compiled, ${draftCount} draft`}
          />
          <Stat
            label="Live campaigns run"
            value={String(liveCampaignIds.size)}
            sub={`${completedLiveCampaigns} completed`}
          />
          <Stat
            label="Live calls placed"
            value={liveResults.length.toLocaleString("en-IN")}
            sub={`${completedLiveCalls.toLocaleString("en-IN")} completed`}
            last
          />
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-4 px-[34px] pb-3.5 pt-[26px]">
          <div className="text-[10.5px] uppercase tracking-[.14em] text-bone/50">
            Saved workflows <span className="text-bone/35">({savedWorkflows.length})</span>
          </div>
          <div className="text-xs text-bone/40">
            Compiled workflows open their latest saved CALL-E campaign
          </div>
        </div>

        {savedWorkflows.length === 0 ? (
          <div className="flex flex-col items-start gap-4 border-t border-bone/[.18] px-[34px] py-16">
            <p className="max-w-md text-[14px] leading-[1.55] text-bone/55">
              No workflows yet. Describe a calling process on the Prompt step and Veyra will
              generate an editable workflow here.
            </p>
            <Link
              href="/"
              className="border border-bone/[.26] px-3.5 py-[9px] text-[12.5px] font-extrabold text-bone no-underline"
            >
              Go to Prompt
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] border-t border-bone/[.18]">
            {savedWorkflows.map((workflow) => (
              <WorkflowCard key={workflow.id} workflow={workflow} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
