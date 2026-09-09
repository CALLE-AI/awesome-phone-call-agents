import { ApiKeysPanel } from "@/lib/console/ApiKeysPanel";
import { requireAccount } from "@/lib/console/auth-gate";
import { toPublicAccount } from "@/lib/accounts";

export default async function ApiKeysPage() {
  const account = await requireAccount();
  return <ApiKeysPanel account={toPublicAccount(account)} />;
}
