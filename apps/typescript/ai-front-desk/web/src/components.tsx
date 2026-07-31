const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: "green",
  BOOKED: "green",
  ACCEPTED: "green",
  QUALIFIED: "green",
  completed: "green",
  SCHEDULED: "blue",
  WAITING: "blue",
  NEW: "blue",
  OPEN: "blue",
  CALLING: "violet",
  OFFERED: "violet",
  WAITLISTED: "violet",
  dry_run: "amber",
  NEEDS_RESCHEDULE: "amber",
  NO_ANSWER: "amber",
  NOT_CALLED: "",
  HELD: "amber",
  CANCELLED: "red",
  NO_SHOW: "red",
  DECLINED: "red",
  NOT_QUALIFIED: "red",
  EXPIRED: "red",
  FAILED: "red",
  failed: "red",
  canceled: "red",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_COLORS[status] ?? ""}`}>{status.replaceAll("_", " ")}</span>;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function maskPhone(phone: string): string {
  return phone.length > 4 ? `${phone.slice(0, 3)}•••${phone.slice(-2)}` : "•••";
}
