import { fieldLabel } from "@/lib/fields";

export function ScopeDiff({
  requested,
  permitted,
  blocked,
}: {
  requested: string[];
  permitted: string[];
  blocked: Array<{ field: string; reason: string }>;
}) {
  const blockedByField = new Map(blocked.map((item) => [item.field, item.reason]));

  return (
    <section className="grid gap-5 md:grid-cols-2">
      <div className="rounded-2xl bg-white p-6 shadow-card">
        <h2 className="text-lg font-semibold">Requested</h2>
        <ul className="mt-4 space-y-2">
          {requested.map((field) => {
            const reason = blockedByField.get(field);
            return (
              <li
                key={field}
                className={`rounded-xl px-4 py-3 text-sm ${
                  reason ? "bg-critical/10 text-critical line-through" : "bg-canvas"
                }`}
              >
                {fieldLabel(field)}
                {reason ? <span className="ml-2 text-xs no-underline">{reason}</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="rounded-2xl bg-white p-6 shadow-card">
        <h2 className="text-lg font-semibold">Permitted</h2>
        <ul className="mt-4 space-y-2">
          {permitted.map((field) => (
            <li key={field} className="rounded-xl bg-canvas px-4 py-3 text-sm">
              {fieldLabel(field)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}