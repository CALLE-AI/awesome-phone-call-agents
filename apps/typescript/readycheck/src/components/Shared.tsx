import { useEffect, useRef, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Check,
  X,
  AlertCircle,
  CircleHelp,
  Clock3,
  GitCompareArrows,
  FlaskConical,
  Phone,
  History,
  Wrench,
  Package,
  Building2,
} from 'lucide-react';
import type { Mode, Verdict } from '../domain/model';
export const templateIcons = { repair: Wrench, rental: Package, venue: Building2 };
export function Logo() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Check size={21} strokeWidth={2.7} />
      </span>
      ReadyCheck<span className="brand-dot">.</span>
    </span>
  );
}
export function ModeBadge({ mode }: { mode: Mode }) {
  const Icon = mode === 'sample' ? FlaskConical : mode === 'live' ? Phone : History;
  return (
    <span className={`mode-badge ${mode}`}>
      <Icon size={12} />
      {mode === 'sample'
        ? 'Fictional demo'
        : mode === 'live'
          ? 'Controlled live'
          : 'Recorded evidence'}
    </span>
  );
}
export function StatusIcon({ verdict, size = 17 }: { verdict: Verdict; size?: number }) {
  const Icon = {
    pass: Check,
    fail: X,
    unknown: CircleHelp,
    stale: Clock3,
    conflict: GitCompareArrows,
  }[verdict];
  return (
    <span className={`status-icon ${verdict}`}>
      <Icon size={size} />
      <span className="sr-only">{verdict}</span>
    </span>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  drawer = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => {
      node?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''} ${drawer ? 'drawer' : ''}`}
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const b = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < b.left ||
            e.clientX > b.right ||
            e.clientY < b.top ||
            e.clientY > b.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <GitCompareArrows size={25} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function InlineError({ message }: { message: string }) {
  return (
    <div className="inline-error" role="alert">
      <AlertCircle size={17} />
      <span>{message}</span>
    </div>
  );
}
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}
