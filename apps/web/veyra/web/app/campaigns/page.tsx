import Link from "next/link";
import { redirect } from "next/navigation";

import StepHeader from "@/components/StepHeader";
import { listUserCampaigns } from "@/lib/db/campaigns-list";
import { getSessionUser } from "@/lib/supabase/auth";

const EYEBROW = "text-[10.5px] uppercase tracking-[.14em] text-bone/45";

function formatCreated(date: Date | null): string {
  if (!date) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "Created just now";
  if (minutes < 60) return `Created ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Created ${hours}h ago`;
  return `Created ${Math.round(hours / 24)}d ago`;
}

export default async function CampaignsListPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login?next=/campaigns");

  const rows = await listUserCampaigns(user.id);

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <StepHeader current="campaign" />

      <main className="flex-1 px-6 pb-[72px] md:px-12">
        <div className="mx-auto w-full max-w-210">
          <div className="flex flex-wrap items-end justify-between gap-6 border-b-2 border-bone/[.26] pb-[22px] pt-[34px]">
            <div>
              <div className={`${EYEBROW} mb-[5px]`}>Your campaigns</div>
              <h1 className="text-3xl font-extrabold tracking-[-.01em] text-bone">
                {rows.length} campaign{rows.length === 1 ? "" : "s"}
              </h1>
            </div>
            <Link
              href="/campaigns/new"
              className="inline-flex flex-none items-center gap-[9px] whitespace-nowrap bg-flame px-[17px] py-3 text-[13.5px] font-extrabold text-ink no-underline"
            >
              New campaign
            </Link>
          </div>

          {rows.length === 0 ? (
            <div className="flex flex-col items-start gap-4 py-16">
              <p className="max-w-md text-[14px] leading-[1.55] text-bone/55">
                No campaigns yet. Start one from a workflow you&apos;ve already generated.
              </p>
              <Link
                href="/campaigns/new"
                className="border border-bone/[.26] px-3.5 py-[9px] text-[12.5px] font-extrabold text-bone no-underline"
              >
                New campaign
              </Link>
            </div>
          ) : (
            <div className="flex flex-col border-t border-bone/[.18]">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-4 border-b border-bone/[.14] py-4 hover:bg-bone/[.03]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <span className="flex-none text-[10px] uppercase tracking-[.14em] text-ember">
                        {row.status}
                      </span>
                      <Link
                        href={`/campaigns/${row.id}`}
                        className="truncate text-[15px] font-extrabold tracking-[-.01em] text-bone no-underline hover:text-blush"
                      >
                        {row.name}
                      </Link>
                    </div>
                    {row.workflowGoal ? (
                      <p className="mt-1 truncate text-xs text-bone/45">{row.workflowGoal}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-none items-center gap-4">
                    <span className="hidden whitespace-nowrap text-[11px] text-bone/35 sm:inline">
                      {formatCreated(row.createdAt)}
                    </span>
                    <Link
                      href={`/campaigns/${row.id}`}
                      className="whitespace-nowrap text-[12px] font-extrabold text-bone/70 underline decoration-bone/25 underline-offset-4"
                    >
                      Open campaign
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
