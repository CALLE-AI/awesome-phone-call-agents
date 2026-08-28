import { StatusBadge, type StatusTone } from "./StatusBadge.js";

export interface CaseSelectorItem {
  id: string;
  label: string;
  summary: string;
  gateLabel: string;
  gateTone: StatusTone;
}

interface CaseSelectorProps {
  cases: CaseSelectorItem[];
  selectedId: string;
  onSelect: (caseId: string) => void;
}

export function CaseSelector({ cases, selectedId, onSelect }: CaseSelectorProps) {
  const moveSelection = (currentIndex: number, direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + cases.length) % cases.length;
    const nextCase = cases[nextIndex];
    if (!nextCase) return;
    onSelect(nextCase.id);
    document.getElementById(`case-tab-${nextCase.id}`)?.focus();
  };

  return (
    <div className="case-tabs" role="tablist" aria-label="Fictional failed visit cases">
      {cases.map((item, index) => (
        <button
          aria-controls="case-workbench"
          aria-selected={item.id === selectedId}
          className="case-tab"
          id={`case-tab-${item.id}`}
          key={item.id}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              moveSelection(index, 1);
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              moveSelection(index, -1);
            }
          }}
          onClick={() => onSelect(item.id)}
          role="tab"
          tabIndex={item.id === selectedId ? 0 : -1}
          type="button"
        >
          <span className="case-tab__number">Case {index + 1}</span>
          <span className="case-tab__id">{item.label}</span>
          <span className="case-tab__summary">{item.summary}</span>
          <StatusBadge tone={item.gateTone}>{item.gateLabel}</StatusBadge>
        </button>
      ))}
    </div>
  );
}
