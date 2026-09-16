export type TimelineState = "complete" | "current" | "pending" | "blocked";

export interface TimelineItem {
  label: string;
  detail: string;
  state: TimelineState;
}

interface TimelineProps {
  items: TimelineItem[];
}

export function Timeline({ items }: TimelineProps) {
  return (
    <ol className="timeline" aria-label="Controlled call workflow">
      {items.map((item) => (
        <li className={`timeline__item timeline__item--${item.state}`} key={item.label}>
          <span className="timeline__marker" aria-hidden="true" />
          <div>
            <strong>{item.label}</strong>
            <p>{item.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
