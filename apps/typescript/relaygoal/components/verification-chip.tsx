// Verification state as a chip. NEVER color-alone: every state carries a distinct
// icon (shape) + text label, so it reads for colorblind users — who are in our audience.

export type ChipStatus = "verified" | "partial" | "unverified" | "unreachable";

const CONFIG: Record<ChipStatus, { label: string; classes: string; icon: React.ReactNode }> = {
  verified: {
    label: "Verified",
    classes: "bg-verified text-verified-foreground",
    icon: (
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="currentColor">
        <path d="M7.5 13.5 3.8 9.8l1.4-1.4 2.3 2.3 6-6 1.4 1.4z" />
      </svg>
    ),
  },
  partial: {
    label: "Partly verified",
    classes: "bg-caution text-caution-foreground",
    icon: (
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="currentColor">
        <path d="M10 2a8 8 0 1 0 0 16V2z" />
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  unverified: {
    label: "Not confirmed",
    classes: "bg-caution text-caution-foreground",
    icon: (
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="currentColor">
        <path d="M10 2 1 18h18L10 2zm0 5 .9 6h-1.8L10 7zm0 8.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z" />
      </svg>
    ),
  },
  unreachable: {
    label: "Couldn't reach",
    classes: "bg-destructive text-destructive-foreground",
    icon: (
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="currentColor">
        <path d="m10 8.6 3.5-3.5 1.4 1.4L11.4 10l3.5 3.5-1.4 1.4L10 11.4l-3.5 3.5-1.4-1.4L8.6 10 5.1 6.5l1.4-1.4z" />
      </svg>
    ),
  },
};

export function VerificationChip({ status, className = "" }: { status: ChipStatus; className?: string }) {
  const c = CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold ${c.classes} ${className}`}
    >
      {c.icon}
      <span>{c.label}</span>
    </span>
  );
}
