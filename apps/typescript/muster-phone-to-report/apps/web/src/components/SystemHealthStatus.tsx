import { renderToStaticMarkup } from "react-dom/server";

export interface SystemHealthStatusProps {
  readonly status: "ready" | "degraded";
}

export function SystemHealthStatus({ status }: SystemHealthStatusProps) {
  const label = status === "ready" ? "System ready" : "System degraded";
  return (
    <section className={`system-health system-health--${status}`} role="status" aria-live="polite">
      <span className="system-health__indicator" aria-hidden="true">
        {status === "ready" ? "●" : "▲"}
      </span>
      <span>{label}</span>
    </section>
  );
}

export async function renderSystemHealthStatusMarkup(
  status: "ready" | "degraded",
): Promise<string> {
  return renderToStaticMarkup(<SystemHealthStatus status={status} />);
}
