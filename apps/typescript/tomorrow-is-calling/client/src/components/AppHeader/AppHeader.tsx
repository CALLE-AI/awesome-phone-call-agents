import type { AppView } from "../../types/navigation";
import "./AppHeader.css";

export function AppHeader({
  view,
  onOverview,
}: {
  view: AppView;
  onOverview: () => void;
}) {
  return (
    <header className="app-header">
      <button className="brand" onClick={onOverview}>
        <span>TOMORROW IS CALLING</span>
        <small>Transport Operations Network</small>
      </button>
      <nav aria-label="Primary navigation">
        <button
          className={view === "overview" ? "active" : ""}
          onClick={onOverview}
        >
          Request queue
        </button>
        <button disabled aria-label="Driver Dispatch, upcoming">
          Driver Dispatch <small>Upcoming</small>
        </button>
        <button disabled aria-label="Call Outcomes, upcoming">
          Call Outcomes <small>Upcoming</small>
        </button>
      </nav>
      <span className="mock-flag">STAFF CONSOLE · LIVE CALL-E</span>
    </header>
  );
}
