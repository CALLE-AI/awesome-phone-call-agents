import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/console-shell";
import { getEvent, getInstrument } from "@/lib/queries";
import { parseJson } from "@/lib/utils";

export default async function InstrumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const instrument = await getInstrument(id);
  if (!instrument) notFound();
  const event = await getEvent(instrument.eventId);
  const questions = parseJson<string[]>(instrument.questionsJson, []);

  return (
    <ConsoleShell eventId={event?.id} eventName={event?.name} active="instrument">
      <div className="rounded-2xl bg-white p-6 shadow-card">
        <h1 className="text-2xl font-semibold">{instrument.title}</h1>
        <p className="mt-2 text-sm text-mute">Version {instrument.version}</p>
        <ol className="mt-6 list-decimal space-y-3 pl-5 text-sm">
          {questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ol>
      </div>
      <div className="rounded-2xl bg-white p-6 shadow-card">
        <p className="mb-3 text-sm text-mute">Task</p>
        <pre className="whitespace-pre-wrap text-[13px] leading-6">{instrument.taskText}</pre>
      </div>
    </ConsoleShell>
  );
}
