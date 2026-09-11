import type { DemoDonor } from "./data.js";
import { CalendarIcon, CheckIcon } from "./icons.js";

interface DrivePanelProps {
  donors: readonly DemoDonor[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function DrivePanel({ donors, selectedId, onSelect }: DrivePanelProps) {
  return (
    <section className="panel drive-panel" aria-labelledby="drive-heading">
      <div className="section-heading">
        <CalendarIcon />
        <h2 id="drive-heading">Confirmation drive</h2>
      </div>
      <dl className="drive-meta">
        <div><dt>Drive ID</dt><dd>drive-a1b2c3d4e5f6</dd></div>
        <div><dt>Approved call window</dt><dd>12:00–13:00 UTC</dd></div>
      </dl>
      <div className="donor-table" role="radiogroup" aria-label="Select donor">
        <div className="donor-header" aria-hidden="true">
          <span>Donor</span><span>Phone (masked)</span><span>Opt-in</span><span>Expected units</span><span>Selected</span>
        </div>
        {donors.map((donor) => {
          const selected = donor.id === selectedId;
          return (
            <button
              className={`donor-row${selected ? " selected" : ""}`}
              key={donor.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(donor.id)}
            >
              <strong>{donor.name}</strong>
              <span className="tabular">{donor.phone}</span>
              <span className="opt-in"><CheckIcon />Yes</span>
              <span>{donor.expected}</span>
              <span className="radio-mark" aria-hidden="true"><i /></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
