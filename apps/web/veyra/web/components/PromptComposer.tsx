"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

const EXAMPLES = [
  {
    id: "wealth",
    label: "Wealth Management",
    text: "Call people who requested information about our wealth management services, understand their financial goals and risk tolerance, qualify them, and book an advisor consultation.",
  },
  {
    id: "education",
    label: "Education",
    text: "Call prospective students who downloaded our course guide, find out which programme and start date they want, check funding, and book a call with admissions.",
  },
  {
    id: "insurance",
    label: "Insurance",
    text: "Call households whose home policy renews in 30 days, confirm cover and property details, flag anyone underinsured, and transfer qualified leads to a broker.",
  },
];

const PLACEHOLDER =
  "Describe the calling process you want, for example: call people who requested information about our wealth management services, understand their financial goals and risk tolerance, qualify them, and book an advisor consultation.";

type NameMode = "ai" | "manual";

export default function PromptComposer({ compact = false }: { compact?: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [nameMode, setNameMode] = useState<NameMode>("ai");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  // Grow with the content, never below the resting height for this layout.
  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, compact ? 152 : 172)}px`;
  };

  useLayoutEffect(autoResize, [compact, prompt]);

  const generate = async () => {
    const manualName = name.replace(/\s+/g, " ").trim();
    if (!prompt.trim() || pending || (nameMode === "manual" && manualName.length < 3)) return;
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/workflows/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          nameMode,
          ...(nameMode === "manual" ? { name: manualName } : {}),
        }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setError(body?.error ?? "Could not generate a workflow, try again.");
        return;
      }

      router.push(`/workflow/${body.workflow.id}`);
    } catch {
      setError("Could not reach the server, try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div className="border-2 border-bone/[.26] bg-panel">
        <div
          className={
            compact
              ? "border-b border-bone/[.18] px-4 py-3.5"
              : "border-b border-bone/[.18] px-[22px] py-4"
          }
        >
          <div
            className={`${nameMode === "manual" ? "mb-2.5 " : ""}${
              compact
                ? "grid grid-cols-[auto_1fr] items-center gap-2"
                : "flex flex-wrap items-center justify-between gap-3"
            }`}
          >
            <label
              htmlFor="workflow-name"
              className={
                compact
                  ? "whitespace-nowrap text-[9px] font-extrabold uppercase tracking-[.07em] text-bone/65"
                  : "text-[11px] font-extrabold uppercase tracking-[.1em] text-bone/65"
              }
            >
              Workflow name
            </label>
            <div
              className={
                compact
                  ? "flex w-fit justify-self-end border border-bone/[.26]"
                  : "flex border border-bone/[.26]"
              }
            >
              {(["ai", "manual"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={nameMode === mode}
                  disabled={pending}
                  onClick={() => setNameMode(mode)}
                  className={`cursor-pointer whitespace-nowrap border-0 font-extrabold disabled:cursor-not-allowed disabled:opacity-50 ${
                    compact
                      ? "px-1 py-1 text-[8px] tracking-[-.02em]"
                      : "px-3 py-1.5 text-[11px]"
                  } ${
                    nameMode === mode
                      ? "bg-flame text-ink"
                      : "bg-transparent text-bone/55"
                  }`}
                >
                  {mode === "ai" ? "Generate with AI" : "Enter manually"}
                </button>
              ))}
            </div>
          </div>
          {nameMode === "manual" ? (
            <input
              id="workflow-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={pending}
              maxLength={48}
              placeholder="For example, Wealth Lead Qualification"
              className={`w-full border border-bone/[.26] bg-ink/30 py-2.5 text-sm text-bone outline-none placeholder:text-bone/30 disabled:cursor-not-allowed disabled:text-bone/35 ${
                compact ? "px-3" : "px-3.5"
              }`}
            />
          ) : null}
        </div>
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
          }}
          placeholder={PLACEHOLDER}
          className={
            compact
              ? "min-h-[152px] w-full resize-none overflow-hidden border-0 bg-transparent px-4 py-4 text-[15px] leading-[1.55] text-bone outline-none placeholder:text-bone/35"
              : "min-h-[172px] w-full resize-none overflow-hidden border-0 bg-transparent px-[22px] py-5 text-base leading-[1.55] text-bone outline-none placeholder:text-bone/35"
          }
        />
        <div
          className={
            compact
              ? "flex flex-col items-stretch gap-2.5 border-t border-bone/[.18] px-3 py-3"
              : "flex items-center justify-between gap-4 border-t border-bone/[.18] py-3 pl-[22px] pr-3.5"
          }
        >
          <span className="text-[11px] uppercase tracking-[.08em] text-bone/[.38]">
            {prompt.length} characters
          </span>
          <button
            type="button"
            onClick={generate}
            disabled={
              !prompt.trim() ||
              pending ||
              (nameMode === "manual" && name.replace(/\s+/g, " ").trim().length < 3)
            }
            className={
              compact
                ? "inline-flex w-full cursor-pointer items-center justify-center gap-2.5 whitespace-nowrap border-0 bg-flame px-[18px] py-3 text-sm font-extrabold tracking-[.02em] text-ink disabled:cursor-not-allowed disabled:opacity-45"
                : "inline-flex cursor-pointer items-center gap-2.5 whitespace-nowrap border-0 bg-flame px-[18px] py-3 text-sm font-extrabold tracking-[.02em] text-ink disabled:cursor-not-allowed disabled:opacity-45"
            }
          >
            {pending ? "Generating…" : "Generate Workflow"}
            {!pending && !compact ? (
              <span className="text-[11px] tracking-[.06em] opacity-70">⌘ ↵</span>
            ) : null}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-[13px] text-blush">{error}</p>}

      <div
        className={
          compact
            ? "mt-5 grid grid-cols-3 gap-2"
            : "mt-[26px] flex flex-wrap items-center gap-2.5"
        }
      >
        <span
          className={`mr-1 text-[11px] uppercase tracking-[.12em] text-bone/[.38] ${
            compact ? "col-span-3" : ""
          }`}
        >
          Examples
        </span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            onClick={() => setPrompt(ex.text)}
            className={
              compact
                ? "cursor-pointer border border-bone/[.26] bg-transparent px-[13px] py-[7px] text-left text-[12.5px] text-bone hover:bg-bone/[.07]"
                : "cursor-pointer border border-bone/[.26] bg-transparent px-[13px] py-[7px] text-[12.5px] text-bone hover:bg-bone/[.07]"
            }
          >
            {ex.label}
          </button>
        ))}
      </div>
    </>
  );
}
