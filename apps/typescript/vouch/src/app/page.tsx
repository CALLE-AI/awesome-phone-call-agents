import { ConsoleShell } from "@/components/console-shell";
import { VouchBoard } from "@/components/vouch-board";
import { getVouchSnapshot } from "@/lib/queries";
import { advanceInProgress } from "@/lib/runner";

export default function VouchHomePage() {
  advanceInProgress();
  const initial = getVouchSnapshot();

  return (
    <ConsoleShell active="consents">
      <VouchBoard initial={initial} />
    </ConsoleShell>
  );
}