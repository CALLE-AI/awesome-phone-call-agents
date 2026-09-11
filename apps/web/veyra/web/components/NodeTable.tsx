"use client";

import { NODE_CHROME } from "@/lib/node-style";
import type { WorkflowNode } from "@/types/workflow";

const TH =
  "border-b-2 border-bone/[.26] px-[22px] py-3 text-left text-[10.5px] uppercase tracking-[.12em] text-bone/50";

/** Tabular summary of the workflow's nodes — the graph's read-first counterpart. */
export default function NodeTable({
  nodes,
  onSelect,
}: {
  nodes: WorkflowNode[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex-1 overflow-auto pb-10">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={`${TH} w-[34%]`}>Step</th>
            <th className={TH}>Purpose</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => {
            const chrome = NODE_CHROME[n.type];
            return (
              <tr
                key={n.id}
                onClick={() => onSelect(n.id)}
                className="cursor-pointer hover:bg-bone/[.04]"
              >
                <td className="border-b border-bone/[.14] px-[22px] py-3.5 align-top">
                  <div className="flex items-baseline gap-2.5">
                    <span
                      className="inline-block size-2 flex-none -translate-y-px border"
                      style={{
                        background: chrome.dot,
                        borderColor: chrome.dotBorder,
                      }}
                    />
                    <span>
                      <span className="block font-extrabold">{n.label}</span>
                      <span className="text-[10.5px] uppercase tracking-[.12em] text-bone/40">
                        {chrome.kicker}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="border-b border-bone/[.14] px-[22px] py-3.5 align-top text-bone/75">
                  {n.say}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
