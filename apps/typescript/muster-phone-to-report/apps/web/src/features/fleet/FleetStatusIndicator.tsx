import type { FleetOperationalState } from "@muster/api-client";

const statePresentation: Readonly<
  Record<
    FleetOperationalState,
    { readonly label: string; readonly icon: string; readonly role: string }
  >
> = {
  normal_observed: { label: "Normal observed", icon: "✓", role: "normal" },
  unreachable: { label: "Unreachable", icon: "×", role: "critical" },
  stale: { label: "Stale", icon: "◷", role: "caution" },
  observation_incomplete: { label: "Observation incomplete", icon: "◐", role: "uncertain" },
  not_observed: { label: "Not observed", icon: "○", role: "neutral" },
};

export interface FleetStatusIndicatorProps {
  readonly state: FleetOperationalState;
  readonly lastKnown?: boolean;
}

export function FleetStatusIndicator({ state, lastKnown = false }: FleetStatusIndicatorProps) {
  const presentation = statePresentation[state];
  const role = lastKnown && state === "normal_observed" ? "neutral" : presentation.role;
  return (
    <span
      className={`fleet-status fleet-status--${role}`}
      data-state={state}
      data-status-role={role}
    >
      <span className="fleet-status__icon" aria-hidden="true">
        {lastKnown && state === "normal_observed" ? "?" : presentation.icon}
      </span>
      <span>
        {lastKnown && state === "normal_observed"
          ? "Last known—update unavailable"
          : presentation.label}
      </span>
    </span>
  );
}
