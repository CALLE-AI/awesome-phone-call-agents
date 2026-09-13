export function SimulationBadge() {
  return (
    <span
      className="simulation-badge"
      data-provenance="simulated"
      aria-label="Simulated data—not physical hardware evidence"
    >
      <span aria-hidden="true">⚗</span>
      SIMULATED
    </span>
  );
}
