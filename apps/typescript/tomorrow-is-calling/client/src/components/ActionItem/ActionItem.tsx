import type { RecommendedAction } from "../../types/report";
import "./ActionItem.css";
export function ActionItem({
  item,
  index,
}: {
  item: RecommendedAction;
  index: number;
}) {
  return (
    <li className="action-item">
      <b>{String(index + 1).padStart(2, "0")}</b>
      <span>
        {item.action}
        <small>Owner: {item.owner}</small>
      </span>
    </li>
  );
}
