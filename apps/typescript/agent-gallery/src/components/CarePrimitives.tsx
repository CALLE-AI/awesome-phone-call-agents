import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { RoutineKind, TimelineStatus } from "../carecall/types";

export function SeniorAvatar({ initials, tone, size = "regular" }: { initials: string; tone: string; size?: "small" | "regular" | "large" }) {
  return <span className="senior-avatar" data-size={size} data-tone={tone} aria-hidden="true">{initials}</span>;
}

export function RoutineIcon({ kind }: { kind: RoutineKind }) {
  return (
    <span className="routine-icon" data-kind={kind} aria-hidden="true">
      <Icon name={kind === "medication" ? "medication" : "food"} size={18} />
    </span>
  );
}

const statusTone: Record<TimelineStatus, "success" | "attention" | "neutral" | "accent"> = {
  "self-reported-taken": "success",
  "self-reported-ate": "success",
  due: "accent",
  upcoming: "neutral",
  "needs-caregiver": "attention",
  "no-answer": "attention",
};

export function StatusPill({ status, label }: { status: TimelineStatus; label: string }) {
  return (
    <span className="status-pill" data-tone={statusTone[status]}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function SectionHeading({ eyebrow, title, action, headingId }: { eyebrow?: string; title: string; action?: ReactNode; headingId?: string }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 id={headingId}>{title}</h2>
      </div>
      {action}
    </div>
  );
}
