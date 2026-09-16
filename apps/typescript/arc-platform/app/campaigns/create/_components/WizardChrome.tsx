"use client"

import { ArrowLeft, ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Shared wizard chrome - BRANDING.md v1.1.
 *
 * Every step renders the same page header, the same step indicator and the
 * same footer action row, so the eye does not move between steps. Before this,
 * each step invented its own layout and its own primary button.
 *
 * Presentation only: no step touches wizard state through this file.
 */

/** One line per step so a first-time user knows what is coming. Supplied copy. */
export const WIZARD_STEPS = [
  { key: "brief", label: "Brief", description: "Tell Arc about your product, your audience and your budget" as string | null },
  { key: "generating", label: "AI", description: "Arc writes the scripts and matches stations and creators" as string | null },
  { key: "scripts", label: "Scripts", description: "Pick the radio scripts you want to run" as string | null },
  { key: "select", label: "Select", description: "Choose stations and creators from Arc's matches" as string | null },
  { key: "review", label: "Review", description: "Check the plan, then launch" as string | null },
] as const

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"]

/**
 * Overall progress, for the header. The header now carries the campaign name
 * and this bar only - the 5-step indicator moved into the page body, where it
 * has room for per-step descriptions.
 */
export function OverallProgress({ current }: { current: WizardStepKey }) {
  const idx = WIZARD_STEPS.findIndex((s) => s.key === current)
  const pct = ((idx + 1) / WIZARD_STEPS.length) * 100
  return (
    <div
      className="h-1 w-32 overflow-hidden rounded-pill bg-hairline sm:w-48"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Step ${idx + 1} of ${WIZARD_STEPS.length}`}
    >
      <div
        className="h-full rounded-pill bg-ink transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/**
 * The 5-step indicator, in the page body below the title.
 *
 * A real 1-5 sequence, so numbering it is correct here - unlike the Brief
 * sub-steps, where a second number sequence would compete with this one.
 */
export function StepIndicator({ current }: { current: WizardStepKey }) {
  const idx = WIZARD_STEPS.findIndex((s) => s.key === current)

  return (
    <ol
      className="grid gap-x-4 gap-y-3 border-y border-border py-5 sm:grid-cols-3 lg:grid-cols-5"
      aria-label="Campaign steps"
    >
      {WIZARD_STEPS.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "current" : "upcoming"
        return (
          <li
            key={s.key}
            aria-current={state === "current" ? "step" : undefined}
            className="flex flex-col gap-1.5"
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "type-data flex size-6 shrink-0 items-center justify-center rounded-pill text-[11px]",
                  state === "current" && "bg-ink text-paper",
                  state === "done" && "bg-hairline text-text-muted",
                  state === "upcoming" && "border border-border text-text-muted/60"
                )}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  "text-small font-medium",
                  state === "current" && "text-text",
                  state === "done" && "text-text-muted",
                  state === "upcoming" && "text-text-muted/60"
                )}
              >
                {s.label}
              </span>
            </span>
            {/* A step with no description simply has none. The placeholder that
                stood here rendered "TODO — one-line description" in danger red,
                inside the wizard, which is the spine of the demo. */}
            {s.description && (
              <span className="text-small text-text-muted">{s.description}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Sub-step device for a step that splits internally (currently Brief).
 *
 * Deliberately NOT numbered and deliberately unlike StepIndicator: a thin
 * segmented bar plus a text label. Two numbered sequences on one screen is the
 * problem the section badges had.
 */
export function SubStepProgress({
  labelPrefix,
  steps,
  current,
}: {
  labelPrefix: string
  steps: readonly string[]
  current: number
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-small font-medium text-text">
        {labelPrefix} — {steps[current]}
      </span>
      <div
        className="flex gap-1"
        role="progressbar"
        aria-valuenow={current + 1}
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-label={`${labelPrefix}, part ${current + 1} of ${steps.length}`}
      >
        {steps.map((label, i) => (
          <span
            key={label}
            className={cn(
              "h-1 flex-1 rounded-pill transition-colors duration-300 motion-reduce:transition-none",
              i <= current ? "bg-ink" : "bg-hairline"
            )}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Page header for a step. Same shape on all five, and it now owns the 5-step
 * indicator, which sits directly below the title where there is room for the
 * per-step descriptions.
 */
export function StepHeader({
  title,
  subtitle,
  current,
}: {
  title: string
  subtitle?: string
  current?: WizardStepKey
}) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-h1 text-text">{title}</h1>
        {subtitle ? <p className="text-body text-text-muted">{subtitle}</p> : null}
      </div>
      {current ? <StepIndicator current={current} /> : null}
    </header>
  )
}

/**
 * Footer action row. Back is ghost on the left, primary is bottom-right, in
 * the same position on every step. `note` sits with the actions rather than
 * floating under a full-width button.
 */
export function StepActions({
  backLabel,
  onBack,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryLoading,
  note,
}: {
  backLabel: string
  onBack: () => void
  primaryLabel: string
  onPrimary: () => void
  primaryDisabled?: boolean
  primaryLoading?: boolean
  note?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden strokeWidth={1.75} />
          {backLabel}
        </Button>
        {note ? (
          <p className="hidden max-w-md text-small text-text-muted lg:block">{note}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        {/* Only while the primary is disabled: a disabled button cannot be
            clicked to reveal what is missing. */}
        {primaryDisabled ? (
          <p className="text-small text-text-muted">Fill the fields marked * to continue</p>
        ) : null}
        <Button
          onClick={onPrimary}
          disabled={primaryDisabled}
          loading={primaryLoading}
          size="lg"
        >
          {primaryLabel}
          {/* Suppressed while disabled: the label is then an instruction
              ("Select at least 1 script to continue"), not a forward action. */}
          {primaryDisabled || primaryLoading ? null : (
            <ArrowRight aria-hidden strokeWidth={1.75} />
          )}
        </Button>
      </div>
    </div>
  )
}

/** Consistent section card for step content. */
export function StepSection({
  title,
  aside,
  children,
  className,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-5 rounded-card bg-surface p-6 shadow-card sm:p-8",
        className
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-h3 text-text">{title}</h2>
        {aside ? <span className="text-small text-text-muted">{aside}</span> : null}
      </div>
      {children}
    </section>
  )
}

/** Error text under a field. Uses --danger, matching the Input error state. */
export function FieldError({ children }: { children?: string }) {
  if (!children) return null
  return <p className="text-small text-danger">{children}</p>
}

/**
 * Selectable chip/card. Uses the Button primitive rather than a hand-rolled
 * pill; selection is a --lilac field per the density rule, not an ink fill.
 */
export function SelectChip({
  selected,
  disabled,
  pill,
  onClick,
  className,
  children,
}: {
  selected: boolean
  disabled?: boolean
  pill?: boolean
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        pill ? "rounded-pill" : "rounded-control",
        selected && "border-lilac-deep bg-lilac hover:bg-lilac",
        className
      )}
    >
      {children}
    </Button>
  )
}
