import React from 'react';
import { ShieldCheck, ShieldAlert, Clock, PhoneOff, Layers, AlertCircle } from 'lucide-react';
import { VerificationStats } from '../types/index.js';

interface SummaryBarProps {
  stats: VerificationStats;
}

export const SummaryBar: React.FC<SummaryBarProps> = ({ stats }) => {
  const cards = [
    {
      label: 'Total Tasks',
      value: stats.total,
      icon: Layers,
      iconColor: 'text-slate-600',
    },
    {
      label: 'In Progress',
      value: stats.inProgress,
      icon: Clock,
      iconColor: 'text-blue-600',
    },
    {
      label: 'Verified',
      value: stats.verified,
      icon: ShieldCheck,
      iconColor: 'text-emerald-600',
    },
    {
      label: 'Contradicted',
      value: stats.contradicted,
      icon: ShieldAlert,
      iconColor: 'text-rose-600',
    },
    {
      label: 'Unreachable',
      value: stats.unreachable,
      icon: PhoneOff,
      iconColor: 'text-slate-400',
    },
    {
      label: 'Needs Review',
      sublabel: 'Inconclusive / Manual',
      value: stats.needsReview,
      icon: AlertCircle,
      iconColor: 'text-amber-500',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5">
              <span className="font-medium text-[11px] truncate">{card.label}</span>
              <Icon className={`w-3.5 h-3.5 ${card.iconColor} shrink-0`} />
            </div>
            <div className="flex items-baseline justify-between gap-1">
              <div className="text-2xl font-bold font-mono text-slate-900 tracking-tight">
                {card.value}
              </div>
              {card.sublabel && (
                <span className="text-[10px] text-slate-400 font-normal">
                  {card.sublabel}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
