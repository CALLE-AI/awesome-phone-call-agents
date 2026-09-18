import type { ApplicationInput } from "@/lib/types";

/** One source document at a time — see `SOURCES`. */
export type SourceKey = "jobDescription" | "resume" | "answers";

const SOURCES: Array<{ key: SourceKey; tab: string; placeholder: string }> = [
  {
    key: "jobDescription",
    tab: "Job",
    placeholder: "Paste the role, its requirements, and how the team evaluates candidates.",
  },
  { key: "resume", tab: "Résumé", placeholder: "Paste the résumé text." },
  {
    key: "answers",
    tab: "Answers",
    placeholder: "Paste the candidate’s answers to the application questions.",
  },
];

type Props = {
  application: ApplicationInput;
  source: SourceKey;
  busy: boolean;
  onChange: (application: ApplicationInput) => void;
  onSourceChange: (source: SourceKey) => void;
  onAnalyze: () => void;
  onLoadExample: () => void;
};

export function ApplicationForm({
  application,
  source,
  busy,
  onChange,
  onSourceChange,
  onAnalyze,
  onLoadExample,
}: Props) {
  const canAnalyze =
    application.jobDescription.trim().length > 0 &&
    (application.resume.trim().length > 0 || application.answers.trim().length > 0);

  return (
    <section className="rise space-y-4">
      {/* One document at a time. Three stacked textareas ask you to read an
          application; three tabs ask you to read a résumé. */}
      <div
        role="tablist"
        aria-label="Application source"
        className="flex gap-1 rounded-xl border border-line bg-panel/50 p-1"
      >
        {SOURCES.map(({ key, tab }) => {
          const filled = application[key].trim().length > 0;
          const selected = source === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSourceChange(key)}
              className={[
                "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition",
                selected
                  ? "bg-line/70 text-chalk shadow-sm"
                  : "text-fog hover:text-chalk",
              ].join(" ")}
            >
              {tab}
              {/* Reserved whether or not it is filled, so switching tabs
                  does not shuffle the labels sideways. */}
              <span
                aria-hidden={!filled}
                aria-label={filled ? "has content" : undefined}
                className={`text-[11px] ${filled ? "text-accent" : "text-transparent"}`}
              >
                ✓
              </span>
            </button>
          );
        })}
      </div>

      {SOURCES.map(
        ({ key, tab, placeholder }) =>
          source === key && (
            <textarea
              key={key}
              aria-label={tab}
              value={application[key]}
              onChange={(event) =>
                onChange({ ...application, [key]: event.target.value })
              }
              rows={14}
              placeholder={placeholder}
              spellCheck={false}
              className="w-full resize-y rounded-xl border border-line bg-panel px-4 py-3 text-[14px] leading-relaxed text-chalk outline-none transition placeholder:text-[13px] focus:border-fog"
            />
          ),
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onAnalyze}
          disabled={!canAnalyze || busy}
          className="cursor-pointer rounded-lg bg-chalk px-5 py-2.5 text-sm font-semibold text-ink shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          {busy ? "Reading the application…" : "Find what to clarify"}
        </button>
        <button
          type="button"
          onClick={onLoadExample}
          disabled={busy}
          className="cursor-pointer rounded-lg border border-line px-4 py-2.5 text-sm text-fog transition hover:border-fog hover:text-chalk disabled:opacity-35"
        >
          Load example
        </button>
      </div>
    </section>
  );
}
