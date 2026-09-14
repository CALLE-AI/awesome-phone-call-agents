import type { Risk } from "../../types/report";
import { StatusBadge } from "../StatusBadge/StatusBadge";
import "./RiskItem.css";
export function RiskItem({ risk }: { risk: Risk }) {
  return (
    <article className="risk-item">
      <div>
        <StatusBadge tone={risk.severity === "High" ? "critical" : "attention"}>
          {risk.severity}
        </StatusBadge>
        <h3>{risk.title}</h3>
      </div>
      {risk.impact && <p>{risk.impact}</p>}
    </article>
  );
}
