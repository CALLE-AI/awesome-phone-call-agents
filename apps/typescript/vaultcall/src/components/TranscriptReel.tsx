'use client';

import React, { useState } from 'react';
import { TranscriptTurn } from '@/lib/types';
import { Bot, User, Clock, CheckCheck, Play, Pause } from 'lucide-react';

interface TranscriptReelProps {
  transcript: TranscriptTurn[];
  durationSeconds?: number;
}

export const TranscriptReel: React.FC<TranscriptReelProps> = ({
  transcript,
  durationSeconds = 60,
}) => {
  const [activeTurn, setActiveTurn] = useState<number | null>(null);

  const formatTimestamp = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="bg-panel border border-panel-border rounded-xl overflow-hidden">
      {/* Header with Call Duration & Status */}
      <div className="px-5 py-3 border-b border-panel-border bg-slate-900/50 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="h-2 w-2 rounded-full bg-accent-emerald animate-pulse" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-300">
            CALL-E Forensic Audio & Transcript Reel
          </h3>
        </div>
        <div className="flex items-center space-x-3 text-xs font-mono text-slate-400">
          <span className="flex items-center space-x-1">
            <Clock className="h-3.5 w-3.5" />
            <span>{durationSeconds}s runtime</span>
          </span>
          <span className="px-2 py-0.5 rounded bg-panel-hover border border-panel-border text-slate-300">
            {transcript.length} turns
          </span>
        </div>
      </div>

      {/* Interactive Turn List */}
      <div className="p-4 space-y-3 max-h-[480px] overflow-y-auto">
        {transcript.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-xs font-mono">
            No audio turns recorded yet. Dispatch verification call to stream transcript.
          </div>
        ) : (
          transcript.map((turn) => {
            const isAgent = turn.speaker === 'agent';
            const isSelected = activeTurn === turn.index;

            return (
              <div
                key={turn.index}
                onClick={() => setActiveTurn(isSelected ? null : turn.index)}
                className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                  isAgent
                    ? 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700'
                    : turn.isEvidenceAnchor
                    ? 'bg-emerald-950/20 border-emerald-800/50 hover:border-emerald-700 shadow-sm shadow-emerald-950/30'
                    : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                } ${isSelected ? 'ring-1 ring-accent-cyan border-accent-cyan' : ''}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`h-5 w-5 rounded-md flex items-center justify-center text-[10px] ${
                        isAgent
                          ? 'bg-accent-indigo/20 text-accent-indigo'
                          : 'bg-accent-emerald/20 text-accent-emerald font-bold'
                      }`}
                    >
                      {isAgent ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                    </span>
                    <span className="font-mono text-xs font-semibold text-slate-200">
                      {isAgent ? 'CALL-E Security Agent' : 'Corporate Callee'}
                    </span>
                    {turn.isEvidenceAnchor ? (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 text-[10px] font-mono flex items-center space-x-1">
                        <CheckCheck className="h-2.5 w-2.5" />
                        <span>Evidence Anchor</span>
                      </span>
                    ) : null}
                  </div>

                  <span className="font-mono text-[11px] text-slate-500">
                    +{formatTimestamp(turn.timestampOffsetMs)}
                  </span>
                </div>

                <p className="text-xs text-slate-300 font-sans leading-relaxed pl-7">
                  {turn.text}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
