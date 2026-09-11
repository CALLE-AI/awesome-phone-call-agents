export type StatusTone = "positive" | "warning" | "danger" | "neutral" | "info";

interface StatusBadgeProps {
  children: React.ReactNode;
  tone?: StatusTone;
}

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}
