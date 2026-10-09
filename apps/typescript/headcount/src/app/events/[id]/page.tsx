import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/console-shell";
import { CoverageBoard } from "@/components/coverage-board";
import { getCoverageSnapshot, getEvent } from "@/lib/queries";
import { advanceInProgress } from "@/lib/wave-runner";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();

  advanceInProgress(id);
  const initial = await getCoverageSnapshot(id);

  return (
    <ConsoleShell eventId={event.id} eventName={event.name} active="coverage" tight>
      <CoverageBoard eventId={event.id} initial={initial} />
    </ConsoleShell>
  );
}