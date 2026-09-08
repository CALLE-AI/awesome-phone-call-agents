import { BrainPanel } from "@/lib/console/BrainPanel";
import { HARBOR_ACCOUNT_ID } from "@/lib/sdk/public-key";
import { geminiConfigured } from "@/lib/brain/gemini";
import { readBrainConfig } from "@/lib/brain/config";
import { syncPainCatalogFromCalls } from "@/lib/brain/pipeline";
import { getSundialsDb } from "@/lib/db";

export default function BrainPage() {
  syncPainCatalogFromCalls(getSundialsDb(), HARBOR_ACCOUNT_ID);
  return <BrainPanel initial={readBrainConfig(HARBOR_ACCOUNT_ID)} geminiConfigured={geminiConfigured()} />;
}
