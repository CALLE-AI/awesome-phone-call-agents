type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning";

export function statusVariant(status: string): BadgeVariant {
  switch (status) {
    // "default" is the brand red now — in_progress ("live right now") owns it; done settles into
    // black (secondary) instead, so it doesn't visually compete with in_progress or a declined/
    // destructive-red outcome badge on the same row.
    case "in_progress":
      return "default";
    case "done":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline"; // pending
  }
}

export function outcomeVariant(outcome: string): BadgeVariant {
  switch (outcome) {
    case "qualified":
      return "success";
    case "callback_requested":
      return "secondary";
    case "not_qualified":
      return "warning";
    default:
      return "destructive"; // no_answer, wrong_number, declined
  }
}
