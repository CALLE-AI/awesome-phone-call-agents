import "server-only";

import { desc, eq } from "drizzle-orm";

import { campaigns, workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import type { CampaignStatus } from "@/types/campaign";

export interface CampaignListItem {
  id: string;
  name: string;
  status: CampaignStatus;
  workflowGoal: string | null;
  createdAt: Date | null;
}

/** Used by both web/app/campaigns/page.tsx and web/app/results/page.tsx. */
export async function listUserCampaigns(userId: string): Promise<CampaignListItem[]> {
  const rows = await withRLS(userId, (tx) =>
    tx
      .select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        workflowGoal: workflows.goal,
        createdAt: campaigns.createdAt,
      })
      .from(campaigns)
      .leftJoin(workflows, eq(workflows.id, campaigns.workflowId))
      .orderBy(desc(campaigns.createdAt)),
  );
  return rows.map((row) => ({ ...row, status: row.status as CampaignStatus }));
}
