import { LeadsInbox } from "@/lib/console/LeadsInbox";
import { loadConsole } from "@/lib/console/load";

export default async function LeadsPage() {
  const initial = await loadConsole();
  return <LeadsInbox initial={initial} />;
}
