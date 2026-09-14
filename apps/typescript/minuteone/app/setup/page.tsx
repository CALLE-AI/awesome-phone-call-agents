import { loadBusinessConfig } from "@/lib/config/load";
import { SetupWizard } from "./setup-wizard";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const config = await loadBusinessConfig();

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center bg-background px-6 py-16">
      <div className="w-full max-w-2xl">
        <SetupWizard initialConfig={config} />
      </div>
    </div>
  );
}
