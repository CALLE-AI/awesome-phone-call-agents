import { ApiKeysPanel } from "@/lib/console/ApiKeysPanel";
import { geminiConfigured } from "@/lib/brain/gemini";

export default function ApiKeysPage() {
  return <ApiKeysPanel geminiConfigured={geminiConfigured()} />;
}
