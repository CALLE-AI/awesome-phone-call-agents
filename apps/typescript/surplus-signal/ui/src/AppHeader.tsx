import { ShieldCheckIcon } from "./icons.js";

export function AppHeader() {
  return (
    <header className="app-header">
      <div>
        <h1>SurplusSignal</h1>
        <p>Human-reviewed pickup confirmations</p>
      </div>
      <div className="simulation-status" role="status">
        <ShieldCheckIcon />
        <span>LOCAL SIMULATION · NO CALLS PLACED</span>
      </div>
    </header>
  );
}
