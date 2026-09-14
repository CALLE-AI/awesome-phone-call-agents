import "./StatusBadge.css";
export function StatusBadge({
  tone = "attention",
  children,
}: {
  tone?: "attention" | "critical" | "ready" | "active";
  children: string;
}) {
  return (
    <span className={`status-badge status-badge--${tone}`}>{children}</span>
  );
}
