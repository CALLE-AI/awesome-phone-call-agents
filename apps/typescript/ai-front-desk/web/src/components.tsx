const TAG_CLASS: Record<string, string> = {
  CONFIRMED: "tag-accent-2",
  BOOKED: "tag-accent-2",
  ACCEPTED: "tag-accent-2",
  QUALIFIED: "tag-accent-2",
  completed: "tag-accent-2",
  SCHEDULED: "tag-neutral",
  WAITING: "tag-neutral",
  NEW: "tag-accent",
  OPEN: "tag-neutral",
  CALLING: "tag-accent",
  OFFERED: "tag-accent",
  WAITLISTED: "tag-accent",
  dry_run: "tag-outline",
  NEEDS_RESCHEDULE: "tag-outline",
  NO_ANSWER: "tag-outline",
  NOT_CALLED: "tag-outline",
  HELD: "tag-outline",
  CANCELLED: "tag-outline",
  NO_SHOW: "tag-outline",
  DECLINED: "tag-outline",
  NOT_QUALIFIED: "tag-outline",
  EXPIRED: "tag-outline",
  FAILED: "tag-outline",
  failed: "tag-outline",
  canceled: "tag-outline",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`tag ${TAG_CLASS[status] ?? "tag-neutral"}`}>{status.replaceAll("_", " ")}</span>;
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

function hashStr(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return h;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const AVATAR_PALETTE = [
  ["var(--color-accent-100)", "var(--color-accent-800)"],
  ["var(--color-neutral-200)", "var(--color-neutral-800)"],
  ["var(--color-accent-2-100)", "var(--color-accent-2-800)"],
  ["var(--color-neutral-300)", "var(--color-neutral-900)"],
] as const;

export function Avatar({ name }: { name: string }) {
  const [bg, color] = AVATAR_PALETTE[Math.abs(hashStr(name)) % AVATAR_PALETTE.length]!;
  return (
    <div className="avatar" style={{ background: bg, color }}>
      {initials(name)}
    </div>
  );
}

export function AvatarName({ name }: { name: string }) {
  return (
    <div className="avatar-name">
      <Avatar name={name} />
      <span className="name">{name}</span>
    </div>
  );
}
