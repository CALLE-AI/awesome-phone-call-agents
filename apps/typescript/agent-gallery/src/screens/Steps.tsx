import type { Screen } from "../App";

/**
 * Where the operator is in a flow that ends in a real phone call.
 *
 * The sequence is fixed and short, so showing all five at once is honest about
 * how much is left and, more importantly, shows that authorization sits between
 * preparing a call and placing one.
 */

const STEPS: { id: Screen; label: string }[] = [
  { id: "configure", label: "Configure" },
  { id: "preview", label: "Preview" },
  { id: "authorize", label: "Authorize" },
  { id: "live", label: "Call" },
  { id: "result", label: "Result" },
];

export function Steps({ current }: { current: Screen }) {
  const index = STEPS.findIndex((step) => step.id === current);
  if (index === -1) return null;

  return (
    <ol className="steps" aria-label="Progress">
      {STEPS.map((step, position) => {
        const state = position < index ? "done" : position === index ? "current" : "upcoming";
        return (
          <li key={step.id} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
