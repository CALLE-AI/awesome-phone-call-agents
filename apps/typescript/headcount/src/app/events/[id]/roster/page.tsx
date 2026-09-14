import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/console-shell";
import { getEvent, listRoster } from "@/lib/queries";
import { parseJson } from "@/lib/utils";

export default async function RosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();
  const rows = await listRoster(id);

  return (
    <ConsoleShell eventId={event.id} eventName={event.name} active="roster">
      <div className="overflow-hidden rounded-2xl bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="text-mute">
            <tr>
              <th className="px-6 py-4 font-medium">Household</th>
              <th className="px-6 py-4 font-medium">Phone</th>
              <th className="px-6 py-4 font-medium">Region</th>
              <th className="px-6 py-4 font-medium">Locale</th>
              <th className="px-6 py-4 font-medium">Timezone</th>
              <th className="px-6 py-4 font-medium">HH</th>
              <th className="px-6 py-4 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-6 py-4 font-medium">{row.displayName}</td>
                <td className="px-6 py-4 tabular text-mute">{row.phoneMasked}</td>
                <td className="px-6 py-4">{row.region}</td>
                <td className="px-6 py-4">{row.locale}</td>
                <td className="px-6 py-4 text-mute">{row.timezone}</td>
                <td className="px-6 py-4 tabular">{row.householdSize ?? "—"}</td>
                <td className="px-6 py-4 text-mute">
                  {parseJson<string[]>(row.flagsJson, []).join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ConsoleShell>
  );
}
