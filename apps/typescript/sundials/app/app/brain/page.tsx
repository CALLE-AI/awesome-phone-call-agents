import { BrainPanel } from "@/lib/console/BrainPanel";
import { requireAccount } from "@/lib/console/auth-gate";
import { geminiConfigured } from "@/lib/brain/gemini";
import { readBrainConfig } from "@/lib/brain/config";
import { syncPainCatalogFromCalls } from "@/lib/brain/pipeline";
import { getSundialsDb } from "@/lib/db";

export default async function BrainPage() {
  const account = await requireAccount();
  syncPainCatalogFromCalls(getSundialsDb(), account.id);
  return <BrainPanel initial={readBrainConfig(account.id)} geminiConfigured={geminiConfigured()} />;
}
