import type { NodeType } from "@/types/workflow";

/** Node box dimensions in graph coordinates — edge routing depends on these. */
export const NODE_W = 214;
export const NODE_H = 74;

export interface NodeChrome {
  kicker: string;
  fill: string;
  text: string;
  border: string;
  kickerColor: string;
  /** Colour of the small square that stands in for the node in the table view. */
  dot: string;
  dotBorder: string;
}

export const NODE_CHROME: Record<NodeType, NodeChrome> = {
  start: {
    kicker: "Start",
    fill: "#ec3013",
    text: "#141312",
    border: "2px solid #ec3013",
    kickerColor: "rgba(20,19,18,.65)",
    dot: "#ec3013",
    dotBorder: "transparent",
  },
  question: {
    kicker: "Question",
    fill: "#211f1e",
    text: "#f3f2f2",
    border: "1px solid rgba(243,242,242,.3)",
    kickerColor: "rgba(243,242,242,.45)",
    dot: "rgba(243,242,242,.35)",
    dotBorder: "transparent",
  },
  decision: {
    kicker: "Branch",
    fill: "#1b1918",
    text: "#f3f2f2",
    border: "2px solid #ec3013",
    kickerColor: "#ff9783",
    dot: "#ec3013",
    dotBorder: "#ec3013",
  },
  terminal: {
    kicker: "Terminal",
    fill: "#f3f2f2",
    text: "#1a1817",
    border: "2px solid #f3f2f2",
    kickerColor: "rgba(26,24,23,.55)",
    dot: "#f3f2f2",
    dotBorder: "transparent",
  },
};
