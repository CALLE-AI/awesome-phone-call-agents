'use client';

import React, { useState } from 'react';
import { VerificationRecord } from '@/lib/types';
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  AlertTriangle,
  PhoneCall,
  FileCheck2,
  ExternalLink,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

interface VerificationCardProps {
  record: VerificationRecord;
  onSelect: (record: VerificationRecord) => void;
  onDispatch: (id: string, scenario?: string) => Promise<void>;
  onViewCertificate: (record: VerificationRecord) => void;
}

export const VerificationCard: React.FC<VerificationCardProps> = ({
  record,
  onSelect,
  onDispatch,
  onViewCertificate,
}) => {
  const [isCalling, setIsCalling] = useState(false);
  const { vendor, request, status, airgapResult, certificate } = record;

  const exposureFormatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(request.totalExposureAmountUsd);

  const handleRunCall = async (e: React.MouseEvent, scenario?: string) => {
    e.stopPropagation();
    setIsCalling(true);
    try {
      await onDispatch(record.id, scenario);
    } finally {
      setIsCalling(false);
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'CONFIRMED_VALID':
        return (
          <span className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-emerald-950/70 border border-emerald-600/60 text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>CONFIRMED VALID</span>
          </span>
        );
      case 'FRAUD_INTERCEPTED':
        return (
          <span className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-rose-950/80 border border-rose-600/70 text-rose-400 animate-pulse">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>BEC FRAUD INTERCEPTED</span>
          </span>
        );
      case 'GATEKEEPER_HOLD':
        return (
          <span className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-amber-950/70 border border-amber-600/60 text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>GATEKEEPER HOLD</span>
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-cyan-950/70 border border-cyan-500/60 text-cyan-400">
            <Clock className="h-3.5 w-3.5 animate-spin" />
            <span>CALL-E DIALING</span>
          </span>
        );
      case 'KILLED_BY_OPERATOR':
        return (
          <span className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-slate-900 border border-slate-700 text-slate-400">
            <span>KILLED BY OPERATOR</span>
          </span>
        );
      default:
        return (
          <span className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-slate-800 text-slate-300">
            <span>PENDING VERIFICATION</span>
          </span>
        );
    }
  };

  return (
    <div
      onClick={() => onSelect(record)}
      className="group p-6 rounded-2xl bg-panel border border-panel-border hover:border-slate-700 transition-all cursor-pointer shadow-lg hover:shadow-cyan-500/10 relative overflow-hidden"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        {/* Vendor & Invoice Details */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-extrabold text-white group-hover:text-accent-cyan transition-colors">
              {vendor.name}
            </h3>
            {getStatusBadge()}
            <span className="text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
              {vendor.soxRiskTier}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-y-1 gap-x-5 text-xs sm:text-sm text-slate-400 font-mono">
            <span>
              Officer: <span className="text-slate-200 font-medium">{vendor.authorizedOfficer.name} ({vendor.authorizedOfficer.title})</span>
            </span>
            <span>
              Target PBX: <span className="text-emerald-400 font-semibold">{vendor.verifiedPbxPhone}</span>
            </span>
            <span>
              Invoices: <span className="text-slate-300">{request.associatedInvoiceNumbers.join(', ')}</span>
            </span>
          </div>
        </div>

        {/* Financial Exposure & Actions */}
        <div className="flex items-center justify-between lg:justify-end space-x-6 shrink-0">
          <div className="text-right">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
              Wire Exposure
            </span>
            <span className="font-mono text-xl sm:text-2xl font-extrabold text-white">
              {exposureFormatted}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2.5">
            {certificate ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewCertificate(record);
                }}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-700/50 text-emerald-300 transition-colors"
              >
                <FileCheck2 className="h-3.5 w-3.5" />
                <span>Certificate</span>
              </button>
            ) : null}

            <button
              onClick={(e) => handleRunCall(e)}
              disabled={isCalling}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-panel-hover hover:bg-slate-700/80 border border-panel-border text-slate-200 transition-colors"
            >
              <PhoneCall className={`h-3.5 w-3.5 ${isCalling ? 'animate-bounce' : ''}`} />
              <span>{isCalling ? 'Dialing...' : 'Run CALL-E'}</span>
            </button>

            <button className="p-1.5 rounded-lg text-slate-400 group-hover:text-white group-hover:bg-slate-800 transition-colors">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
