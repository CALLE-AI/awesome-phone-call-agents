'use client';

import { Load } from '@/lib/types';
import { Phone, Handshake, Scale, Check } from 'lucide-react';

interface LoadStatusStepperProps {
  status: Load['status'];
  isSourcing?: boolean;
  currentRound?: 0 | 1 | 2;
  negotiationCount?: number;
}

type StepIndex = 0 | 1 | 2 | 3;

const STEPS = [
  { label: 'Sourcing', Icon: Phone },
  { label: 'Negotiating', Icon: Handshake },
  { label: 'Comparing', Icon: Scale },
  { label: 'Ready to Book', Icon: Check },
] as const;

const TOTAL_STEPS = STEPS.length;

function getStepIndex(status: Load['status']): StepIndex {
  switch (status) {
    case 'uncovered':
    case 'sourcing':
      return 0;
    case 'negotiating':
      return 1;
    case 'quoted':
    case 'recommended':
      return 2;
    case 'booked':
      return 3;
  }
}

/**
 * Returns true when the action for a given step is actually in flight,
 * based on the real store flags — not just step-index equality.
 *
 * Step 0 (Sourcing):  isSourcing && currentRound === 1
 * Step 1 (Negotiating): isSourcing && currentRound === 2
 * Step 2 (Comparing): No action-in-progress flag exists (synchronous comparison)
 * Step 3 (Ready to Book): No action-in-progress flag exists (no booking loading state)
 */
function isStepActionInProgress(
  stepIdx: StepIndex,
  isSourcing: boolean,
  currentRound: 0 | 1 | 2,
): boolean {
  switch (stepIdx) {
    case 0:
      return isSourcing && currentRound === 1;
    case 1:
      return isSourcing && currentRound === 2;
    case 2:
    case 3:
      return false;
  }
}

function getSublabel(
  stepIdx: StepIndex,
  activeStep: StepIndex,
  actionInProgress: boolean,
  negotiationCount?: number,
): string {
  if (stepIdx !== activeStep) {
    return '';
  }
  if (!actionInProgress) {
    return 'Pending';
  }
  if (stepIdx === 1 && negotiationCount !== undefined) {
    return `${negotiationCount} active`;
  }
  return 'In progress';
}

/**
 * Determine the 3-state visual treatment for each step circle:
 *
 * 1. Completed or active (idx <= activeStep):
 *    Solid bg-brand circle, white icon. Label text-brand when active.
 *
 * 2. Upcoming, not the final step (idx > activeStep && idx < totalSteps - 1):
 *    White/surface-card bg, brand border ring, brand icon.
 *
 * 3. Final step, not yet reached (idx === totalSteps - 1 && idx > activeStep):
 *    Muted surface-page bg, surface-border ring, ink-subtle icon (gray).
 */
function getCircleStyles(idx: number, activeStep: StepIndex): {
  circleClass: string;
  iconColor: string;
  labelClass: string;
  sublabelClass: string;
} {
  const isCompletedOrActive = idx <= activeStep;
  const isFinalUnreached = idx === TOTAL_STEPS - 1 && idx > activeStep;

  if (isCompletedOrActive) {
    return {
      circleClass: 'bg-brand border-0 text-white',
      iconColor: '#FFFFFF',
      labelClass: idx === activeStep ? 'text-brand' : 'text-ink',
      sublabelClass: 'text-ink-muted',
    };
  }

  if (isFinalUnreached) {
    return {
      circleClass: 'bg-surface-page border border-surface-border text-ink-subtle',
      iconColor: '#64748B',
      labelClass: 'text-ink',
      sublabelClass: 'text-ink-subtle',
    };
  }

  // Upcoming, not final — brand ring, brand icon
  return {
    circleClass: 'bg-surface-card border-[1.5px] border-brand text-brand',
    iconColor: '#1A62FC',
    labelClass: 'text-ink',
    sublabelClass: 'text-ink-muted',
  };
}

/**
 * Determine the connecting line color between step i and step i+1.
 * Blue only if step i is genuinely completed OR step i is the active step
 * AND its real action-state flag shows it's actually in progress.
 * Otherwise gray — uses the same source of truth as the sublabel gating.
 */
function getLineColor(
  isCompleted: boolean,
  actionInProgress: boolean,
): string {
  return isCompleted || actionInProgress ? 'bg-brand' : 'bg-surface-border';
}

export default function LoadStatusStepper({
  status,
  isSourcing = false,
  currentRound = 0,
  negotiationCount,
}: LoadStatusStepperProps) {
  const activeStep = getStepIndex(status);

  return (
    <div className="flex flex-col gap-20">
      {STEPS.map((step, idx) => {
        const stepIdx = idx as StepIndex;
        const actionInProgress =
          idx <= activeStep &&
          isStepActionInProgress(stepIdx, isSourcing, currentRound);

        const isCompleted = idx < activeStep;

        const { circleClass, iconColor, labelClass, sublabelClass } =
          getCircleStyles(idx, activeStep);

        const sublabelText = getSublabel(
          stepIdx,
          activeStep,
          actionInProgress,
          negotiationCount,
        );
        const showSublabel = idx === activeStep && sublabelText !== '';

        const isLast = idx === STEPS.length - 1;

        return (
          <div key={step.label} className="relative flex gap-7">
            {/* Circle column (positioned relative so line can be absolute) */}
            <div className="relative flex w-[60px] shrink-0 items-start justify-center">
              {/* Circle */}
              <div
                className={`flex h-[60px] w-[60px] items-center justify-center rounded-full ${circleClass}`}
              >
                <step.Icon size={24} color={iconColor} />
              </div>

              {/* Connecting line — absolutely positioned, fixed height matching gap-20 */}
              {!isLast && (
                <div
                  className={`absolute left-1/2 top-[60px] -translate-x-1/2 h-20 w-1 ${getLineColor(isCompleted, actionInProgress)}`}
                />
              )}
            </div>

            {/* Label + sublabel */}
            <div className="flex flex-col justify-center">
              <span className={`text-sm font-semibold ${labelClass}`}>
                {step.label}
              </span>
              {showSublabel && (
                <span className={`text-xs ${sublabelClass}`}>
                  {sublabelText}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
