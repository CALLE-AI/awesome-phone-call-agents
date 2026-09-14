import { LeadsInbox } from "@/lib/console/LeadsInbox";
import { requireAccount } from "@/lib/console/auth-gate";
import { loadConsole } from "@/lib/console/load";

export default async function LeadsPage() {
  const account = await requireAccount();
  const initial = await loadConsole(undefined, account.id);
  return <LeadsInbox initial={initial} />;
}
