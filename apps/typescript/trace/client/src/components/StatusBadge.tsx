import React from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  PhoneCall,
  PhoneOff,
  HelpCircle,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
} from 'lucide-react';
import { CallState, VerificationOutcome, ReviewStatus, ClaimedStatus, AvailabilityStatus } from '../types/index.js';

interface StatusBadgeProps {
  type: 'call' | 'verification' | 'review' | 'claim' | 'reality';
  value: CallState | VerificationOutcome | ReviewStatus | ClaimedStatus | AvailabilityStatus | string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ type, value, size = 'sm' }) => {
  const sizeClasses = size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-xs';

  if (type === 'verification') {
    switch (value) {
      case 'VERIFIED':
      case 'VERIFIED_CONFIRMED':
        return (
          <span className={`inline-flex items-center gap-1 font-semibold rounded-full bg-[#F0FDF4] text-[#166534] border border-[#86EFAC] ${sizeClasses}`}>
            <ShieldCheck className="w-3.5 h-3.5 text-[#16A34A]" />
            VERIFIED
          </span>
        );
      case 'CONTRADICTED':
      case 'VERIFIED_DISCREPANCY':
        return (
          <span className={`inline-flex items-center gap-1 font-semibold rounded-full bg-[#FEF2F2] text-[#991B1B] border border-[#FCA5A5] ${sizeClasses}`}>
            <ShieldAlert className="w-3.5 h-3.5 text-[#DC2626]" />
            CONTRADICTED
          </span>
        );
      case 'UNREACHABLE':
        return (
          <span className={`inline-flex items-center gap-1 font-semibold rounded-full bg-[#F1F5F9] text-[#334155] border border-[#CBD5E1] ${sizeClasses}`}>
            <PhoneOff className="w-3.5 h-3.5 text-[#64748B]" />
            UNREACHABLE
          </span>
        );
      case 'UNKNOWN / INCONCLUSIVE':
      case 'INCONCLUSIVE':
      case 'REQUIRES_REVIEW':
      default:
        return (
          <span className={`inline-flex items-center gap-1 font-semibold rounded-full bg-[#FFFBEB] text-[#92400E] border border-[#FCD34D] ${sizeClasses}`}>
            <HelpCircle className="w-3.5 h-3.5 text-[#D97706]" />
            UNKNOWN / INCONCLUSIVE
          </span>
        );
    }
  }

  if (type === 'review') {
    if (value === 'NEEDS_REVIEW') {
      return (
        <span className={`inline-flex items-center gap-1 font-bold rounded-full bg-[#FFFBEB] text-[#92400E] border border-[#FCD34D] uppercase tracking-wide ${sizeClasses}`}>
          <AlertCircle className="w-3.5 h-3.5 text-[#D97706]" />
          Needs Review
        </span>
      );
    }
    return null;
  }

  if (type === 'call') {
    switch (value) {
      case 'COMPLETED':
        return (
          <span className={`inline-flex items-center gap-1 font-semibold rounded-full bg-[#F0FDF4] text-[#166534] border border-[#86EFAC] ${sizeClasses}`}>
            <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />
            Call Completed
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className={`inline-flex items-center gap-1 font-semibold rounded-full bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] animate-pulse ${sizeClasses}`}>
            <Loader2 className="w-3.5 h-3.5 text-[#2563EB] animate-spin" />
            Live In Progress
          </span>
        );
      case 'CALLING':
        return (
          <span className={`inline-flex items-center gap-1 font-semibold rounded-full bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] animate-pulse ${sizeClasses}`}>
            <PhoneCall className="w-3.5 h-3.5 text-[#2563EB] animate-bounce" />
            Dialing Recipient...
          </span>
        );
      case 'QUEUED':
        return (
          <span className={`inline-flex items-center gap-1 font-semibold rounded-full bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] ${sizeClasses}`}>
            <PhoneCall className="w-3.5 h-3.5 text-[#2563EB]" />
            Queued
          </span>
        );
      case 'FAILED':
      case 'CANCELED':
        return (
          <span className={`inline-flex items-center gap-1 font-semibold rounded-full bg-[#FEF2F2] text-[#991B1B] border border-[#FCA5A5] ${sizeClasses}`}>
            <XCircle className="w-3.5 h-3.5 text-[#DC2626]" />
            Failed / Unreachable
          </span>
        );
      case 'IDLE':
      default:
        return (
          <span className={`inline-flex items-center gap-1 font-medium rounded-full bg-[#F8FAFC] text-[#475569] border border-[#E2E8F0] ${sizeClasses}`}>
            <Clock className="w-3.5 h-3.5 text-[#64748B]" />
            Idle
          </span>
        );
    }
  }

  // Claimed / Reality Status
  if (value === 'AVAILABLE' || value === 'available') {
    return (
      <span className={`inline-flex items-center gap-1 font-semibold rounded-md bg-[#F0FDF4] text-[#166534] border border-[#86EFAC] ${sizeClasses}`}>
        Available
      </span>
    );
  }
  if (value === 'UNAVAILABLE' || value === 'unavailable') {
    return (
      <span className={`inline-flex items-center gap-1 font-semibold rounded-md bg-[#FEF2F2] text-[#991B1B] border border-[#FCA5A5] ${sizeClasses}`}>
        Unavailable
      </span>
    );
  }
  if (value === 'RESTRICTED' || value === 'limited') {
    return (
      <span className={`inline-flex items-center gap-1 font-semibold rounded-md bg-[#FFFBEB] text-[#92400E] border border-[#FCD34D] ${sizeClasses}`}>
        Conditional / Limited
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 font-medium rounded-md bg-[#F1F5F9] text-[#334155] border border-[#CBD5E1] ${sizeClasses}`}>
      {value || 'Unknown'}
    </span>
  );
};
