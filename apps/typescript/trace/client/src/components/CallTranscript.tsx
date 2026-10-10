import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, ArrowDown } from 'lucide-react';
import { CallTranscriptTurn } from '../types/index.js';
import { formatNaturalTranscriptText } from '../utils/transcript.js';

interface CallTranscriptProps {
  turns: CallTranscriptTurn[];
  isActive?: boolean;
}

export const CallTranscript: React.FC<CallTranscriptProps> = ({
  turns,
  isActive = false,
}) => {
  const [autoScroll, setAutoScroll] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevTurnsLengthRef = useRef(turns.length);

  const scrollToBottom = useCallback((smooth = true) => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
      setUnreadCount(0);
      setIsAtBottom(true);
    }
  }, []);

  // Handle scroll event to detect if user has scrolled away from bottom
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    const atBottom = distanceToBottom < 60;

    setIsAtBottom(atBottom);
    if (atBottom) {
      setUnreadCount(0);
    }
  };

  // When turns update
  useEffect(() => {
    const newItems = turns.length - prevTurnsLengthRef.current;
    prevTurnsLengthRef.current = turns.length;

    if (newItems > 0) {
      if (autoScroll && isAtBottom) {
        scrollToBottom(true);
      } else if (!isAtBottom) {
        setUnreadCount((prev) => prev + newItems);
      }
    }
  }, [turns, autoScroll, isAtBottom, scrollToBottom]);

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 overflow-hidden relative shadow-xs">
      {/* Header */}
      <div className="px-5 py-3.5 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-900">
            Live Conversation
          </span>
          {isActive && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-semibold px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Connected
            </span>
          )}
        </div>

        <button
          onClick={() => {
            const next = !autoScroll;
            setAutoScroll(next);
            if (next) scrollToBottom(true);
          }}
          className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors"
        >
          {autoScroll ? (
            <>
              <Pause className="w-3 h-3 text-slate-500" /> Auto-Scroll On
            </>
          ) : (
            <>
              <Play className="w-3 h-3 text-slate-500" /> Resume Auto-Scroll
            </>
          )}
        </button>
      </div>

      {/* Transcript Log Body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="p-5 overflow-y-auto flex-1 space-y-3 font-sans relative bg-white"
      >
        {turns.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            {isActive ? (
              <div className="space-y-3">
                <div className="w-3.5 h-3.5 rounded-full bg-blue-600 animate-ping mx-auto" />
                <p className="text-slate-700 font-medium">Calling supplier line... Waiting for audio connection.</p>
              </div>
            ) : (
              <p className="text-slate-400">No conversation recorded for this verification yet.</p>
            )}
          </div>
        ) : (
          turns.map((turn) => {
            const isAI = turn.speaker === 'AI';

            return (
              <div
                key={turn.id}
                className="flex flex-col space-y-1.5 items-start"
              >
                {/* Speaker Label & Timestamp */}
                <div className="flex items-center gap-2 px-1 text-xs">
                  <span
                    className={`font-bold tracking-wider uppercase text-[11px] ${
                      isAI ? 'text-[#1D4ED8]' : 'text-[#334155]'
                    }`}
                  >
                    {isAI ? 'TRACE' : 'Supplier'}
                  </span>
                  <span className="text-[#64748B] font-mono text-[11px]">{turn.timestamp}</span>
                </div>

                {/* Speech Container */}
                <div
                  className={`px-4 py-2.5 rounded-xl text-[13.5px] leading-relaxed max-w-2xl font-normal shadow-xs ${
                    isAI
                      ? 'bg-[#EFF6FF] text-[#0F172A] border border-[#BFDBFE]'
                      : 'bg-[#F1F5F9] text-[#0F172A] border border-[#E2E8F0]'
                  }`}
                >
                  {formatNaturalTranscriptText(turn.text)}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Floating Unread / Jump-to-Bottom Pill */}
      {unreadCount > 0 && !isAtBottom && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 animate-bounce">
          <button
            onClick={() => scrollToBottom(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-md text-xs font-semibold transition-all"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            <span>{unreadCount} new message{unreadCount > 1 ? 's' : ''}</span>
          </button>
        </div>
      )}
    </div>
  );
};
