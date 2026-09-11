"use client";

export type CallStage = "dialing" | "oncall" | "done";

const STEPS = ["Queued", "Dialing", "On the call", "Result ready"] as const;

function stageIndex(stage: CallStage): number {
  return stage === "dialing" ? 1 : stage === "oncall" ? 2 : 3;
}

export function CallStatusTimeline({
  stage,
  captions,
  phoneMasked,
}: {
  stage: CallStage;
  captions: { speaker: string; text: string; offsetSeconds: number }[];
  phoneMasked: string;
}) {
  const current = stageIndex(stage);

  return (
    <section aria-labelledby="progress-heading" className="rounded-xl border border-border bg-card p-5">
      <h2 id="progress-heading" className="text-lg">
        {stage === "done" ? "Call finished" : "Calling for you…"}{" "}
        <span className="font-mono text-sm text-muted-foreground">{phoneMasked}</span>
      </h2>

      <ol className="mt-4 flex flex-wrap gap-2" aria-label="Call progress">
        {STEPS.map((label, i) => {
          const state = i < current ? "done" : i === current ? "current" : "upcoming";
          return (
            <li
              key={label}
              aria-current={state === "current" ? "step" : undefined}
              className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-semibold ${
                state === "done"
                  ? "bg-verified text-verified-foreground"
                  : state === "current"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              <span
                aria-hidden="true"
                className={`relative flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  state === "upcoming" ? "bg-background/60" : "bg-background/25"
                }`}
              >
                {i + 1}
                {state === "done" && (
                  <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor" className="absolute -right-1 -top-1">
                    <path d="M7.5 13.5 3.8 9.8l1.4-1.4 2.3 2.3 6-6 1.4 1.4z" />
                  </svg>
                )}
              </span>
              <span className="sr-only">{state === "done" ? "completed: " : state === "current" ? "current: " : ""}</span>
              {label}
            </li>
          );
        })}
      </ol>

      <div className="mt-4" aria-live="polite" aria-atomic="false">
        <p className="sr-only">Live captions of the call:</p>
        <ul className="flex flex-col gap-2">
          {captions.map((c) => {
            const isCallee = c.speaker !== "bot";
            return (
              <li key={c.offsetSeconds} className={isCallee ? "text-foreground" : "text-muted-foreground"}>
                <span className="font-semibold">{isCallee ? "Them: " : "Agent: "}</span>
                {c.text}
              </li>
            );
          })}
          {stage !== "done" && (
            <li className="flex items-center gap-2 text-muted-foreground" aria-hidden="true">
              <span className="font-semibold">{stage === "dialing" ? "Dialing" : "Listening"}</span>
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:200ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:400ms]" />
              </span>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
