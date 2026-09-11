import React from 'react';
import { X } from 'lucide-react';

interface ModalShellProps {
  onClose: () => void;
  maxWidthClassName?: string;
  icon: React.ReactNode;
  iconClassName?: string;
  title: React.ReactNode;
  titleBadge?: React.ReactNode;
  subtitle?: React.ReactNode;
  subheader?: React.ReactNode;
  bodyClassName?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared chrome for the app's full-size modals: overlay, header (icon +
 * title + close button), an optional sticky sub-header (e.g. tab nav), a
 * scrollable body, and an optional sticky footer bar.
 */
export const ModalShell: React.FC<ModalShellProps> = ({
  onClose,
  maxWidthClassName = 'max-w-2xl',
  icon,
  iconClassName = 'bg-teal-600/30 border-teal-500/40 text-teal-300',
  title,
  titleBadge,
  subtitle,
  subheader,
  bodyClassName = 'p-6 space-y-6',
  footer,
  children,
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
    <div
      className={`bg-white rounded-2xl shadow-2xl border border-slate-200 w-full ${maxWidthClassName} max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${iconClassName}`}>
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">{title}</h2>
              {titleBadge}
            </div>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {subheader}

      <div className={`overflow-y-auto flex-1 text-slate-800 ${bodyClassName}`}>
        {children}
      </div>

      {footer && (
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          {footer}
        </div>
      )}
    </div>
  </div>
);
