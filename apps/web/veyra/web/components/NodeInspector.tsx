'use client';

import { useState } from 'react';
import { NODE_CHROME } from '@/lib/node-style';
import type { WorkflowNode } from '@/types/workflow';

const LABEL =
  'mb-[7px] block text-[10.5px] uppercase tracking-[.12em] text-bone/50';
const FIELD =
  'w-full border border-bone/[.26] bg-[#232120] px-3 py-2.5 text-bone outline-none';

interface NodeInspectorProps {
  node: WorkflowNode | null;
  /** Number of edges leaving this node. */
  outgoing: number;
  onClose: () => void;
  onChange: (patch: Partial<WorkflowNode>) => void;
}

/** Right-hand flap: edits the selected node in place. */
export default function NodeInspector({
  node,
  outgoing,
  onClose,
  onChange,
}: NodeInspectorProps) {
  const [newCapture, setNewCapture] = useState('');

  if (!node) {
    return (
      <aside className="flex w-[352px] flex-none flex-col justify-center gap-3 border-l-2 border-bone/[.26] bg-[#1a1817] p-6">
        <span className="size-2 bg-bone/30" />
        <div className="text-[15px] font-extrabold">No node selected</div>
        <p className="m-0 text-[13px] leading-[1.6] text-bone/50">
          Select a step in the graph to edit its label, what the agent says, and
          the data it captures.
        </p>
      </aside>
    );
  }

  const addCapture = () => {
    const name = newCapture.trim();
    if (!name || node.captures.includes(name)) return;
    onChange({ captures: [...node.captures, name] });
    setNewCapture('');
  };

  return (
    <aside className="flex w-[352px] min-h-0 flex-none flex-col border-l-2 border-bone/[.26] bg-[#1a1817]">
      <div className="flex items-center justify-between border-b border-bone/[.18] px-[18px] py-3.5">
        <span className="text-[10.5px] uppercase tracking-[.14em] text-ember">
          {NODE_CHROME[node.type].kicker}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Clear selection"
          className="cursor-pointer border-0 bg-transparent px-1 py-0.5 text-base leading-none text-bone/50"
        >
          ×
        </button>
      </div>

      <div className="flex flex-col gap-5 overflow-auto p-[18px]">
        <label className="block">
          <span className={LABEL}>Label</span>
          <input
            value={node.label}
            onChange={(e) => onChange({ label: e.target.value })}
            className={`${FIELD} text-sm font-extrabold`}
          />
        </label>

        <label className="block">
          <span className={LABEL}>What the agent says</span>
          <textarea
            value={node.say}
            onChange={(e) => onChange({ say: e.target.value })}
            className={`${FIELD} min-h-[112px] resize-y text-[13.5px] leading-[1.55]`}
          />
        </label>

        <div>
          <span className="mb-[9px] block text-[10.5px] uppercase tracking-[.12em] text-bone/50">
            Data captured
          </span>
          <div className="mb-[9px] flex flex-wrap gap-[7px]">
            {node.captures.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-[7px] border border-flame/55 px-[9px] py-[5px] text-[11.5px] text-blush"
              >
                {c}
                <button
                  type="button"
                  onClick={() =>
                    onChange({ captures: node.captures.filter((x) => x !== c) })
                  }
                  aria-label={`Remove ${c}`}
                  className="cursor-pointer border-0 bg-transparent p-0 text-xs leading-none text-inherit opacity-70"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            value={newCapture}
            onChange={(e) => setNewCapture(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCapture();
              }
            }}
            placeholder="add field, press enter"
            className={`${FIELD} py-[9px] text-[13px] placeholder:text-bone/35`}
          />
        </div>

        <div className="flex flex-col gap-2.5 border-t border-bone/[.18] pt-4 text-xs">
          <div className="flex justify-between">
            <span className="text-bone/50">Node type</span>
            <span className="font-extrabold">
              {NODE_CHROME[node.type].kicker}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-bone/50">Outgoing paths</span>
            <span className="font-extrabold">{outgoing}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-bone/50">Node ID</span>
            <span className="font-extrabold text-bone/60">{node.id}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
