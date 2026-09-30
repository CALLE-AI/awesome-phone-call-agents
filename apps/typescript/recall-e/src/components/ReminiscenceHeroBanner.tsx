import React from 'react';
import { PhoneCall, ChevronDown, ChevronUp } from 'lucide-react';
import heroImage from '../assets/images/reminiscence_hero_1788816507295.jpg';

interface ReminiscenceHeroBannerProps {
  onSimulateCall: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const ReminiscenceHeroBanner: React.FC<ReminiscenceHeroBannerProps> = ({
  onSimulateCall,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  if (isCollapsed) {
    return (
      <div className="bg-white rounded-xl border border-slate-200/80 p-3 shadow-2xs flex items-center justify-between gap-3 text-xs mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0 border border-slate-200">
            <img
              src={heroImage}
              alt="Reminiscence Telephony"
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          <span className="font-bold text-slate-900">Reminiscence Telephony</span>
        </div>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1 text-slate-400 hover:text-slate-600 rounded transition cursor-pointer"
            title="Expand banner"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-2xs mb-5">
      <div className="grid grid-cols-1 lg:grid-cols-12">

        {/* Left column: plain text, one action */}
        <div className="p-6 lg:col-span-7 flex flex-col justify-between gap-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 leading-tight">
              Validation therapy calls for memory care
            </h2>
            <p className="text-sm text-slate-600 mt-2.5 leading-relaxed max-w-md">
              Built on CALL-E. Scheduled validation therapy calls for residents living with dementia, grounded in a memory they love, patient and never argumentative.
            </p>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <button
              onClick={onSimulateCall}
              className="flex items-center gap-1.5 bg-white border border-teal-700 text-teal-700 hover:bg-teal-50 text-sm font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
              title="Preview a simulated call script — no real call is placed"
            >
              <PhoneCall className="w-4 h-4" />
              Preview call script
            </button>

            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition cursor-pointer"
              >
                Minimize
                <ChevronUp className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Right column: photo, no overlay badges */}
        <div className="lg:col-span-5 relative min-h-[200px] lg:min-h-full bg-slate-100 overflow-hidden">
          <img
            src={heroImage}
            alt="Resident smiling while on a reminiscence therapy phone call"
            className="w-full h-full object-cover object-center"
            referrerPolicy="no-referrer"
          />
        </div>

      </div>
    </div>
  );
};
