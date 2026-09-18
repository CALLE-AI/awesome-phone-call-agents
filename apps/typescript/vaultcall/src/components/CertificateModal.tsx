'use client';

import React from 'react';
import { VoiceVerificationCertificate } from '@/lib/types';
import { ShieldCheck, ShieldAlert, Award, Hash, CheckCircle, X, Download } from 'lucide-react';

interface CertificateModalProps {
  certificate: VoiceVerificationCertificate;
  onClose: () => void;
}

export const CertificateModal: React.FC<CertificateModalProps> = ({
  certificate,
  onClose,
}) => {
  const isApproved = certificate.verdict === 'WIRE_RELEASE_AUTHORIZED';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-950 border border-panel-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Certificate Header Banner */}
        <div
          className={`px-6 py-5 border-b flex items-center justify-between ${
            isApproved
              ? 'bg-gradient-to-r from-emerald-950/60 to-slate-900 border-emerald-800/40'
              : 'bg-gradient-to-r from-rose-950/60 to-slate-900 border-rose-800/40'
          }`}
        >
          <div className="flex items-center space-x-3">
            <div
              className={`p-2.5 rounded-xl ${
                isApproved ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
              }`}
            >
              {isApproved ? <ShieldCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-white text-base">Certificate of Voice Verification</h3>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                  {certificate.certificateId}
                </span>
              </div>
              <p className="text-xs text-slate-400">SOX 404 & Anti-BEC Wire Verification Standard</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Certificate Body */}
        <div className="p-6 space-y-5 text-xs">
          {/* Status Verdict Banner */}
          <div
            className={`p-4 rounded-xl border flex items-center justify-between ${
              isApproved
                ? 'bg-emerald-950/40 border-emerald-600/40 text-emerald-200'
                : 'bg-rose-950/40 border-rose-600/40 text-rose-200'
            }`}
          >
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider block opacity-75">
                Audit Disposition
              </span>
              <span className="font-mono font-bold text-sm">
                {isApproved ? 'WIRE RELEASE AUTHORIZED' : 'PAYMENT FREEZE: BEC FRAUD INTERCEPTED'}
              </span>
            </div>
            {certificate.erpReleaseToken ? (
              <div className="text-right">
                <span className="text-[10px] font-mono uppercase tracking-wider block opacity-75">
                  ERP Release Token
                </span>
                <span className="font-mono font-bold text-accent-cyan">
                  {certificate.erpReleaseToken}
                </span>
              </div>
            ) : null}
          </div>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-slate-900/60 border border-panel-border">
            <div>
              <span className="text-slate-400 block text-[11px]">Vendor Name</span>
              <span className="font-semibold text-white">{certificate.vendorName}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Authorized Officer Spoken</span>
              <span className="font-mono text-slate-200">{certificate.officerSpokenWith}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Verified Tax EIN</span>
              <span className="font-mono text-slate-200">****{certificate.verifiedTaxEinLast4}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Target Airgap PBX</span>
              <span className="font-mono text-emerald-400">{certificate.targetDialNumber}</span>
            </div>
            <div className="col-span-2 pt-2 border-t border-slate-800">
              <span className="text-slate-400 block text-[11px]">Issued Timestamp (UTC)</span>
              <span className="font-mono text-slate-300">{certificate.issuedAt}</span>
            </div>
          </div>

          {/* Verbatim Spoken Quotes Anchored */}
          <div className="space-y-2">
            <span className="font-mono text-slate-400 block text-[11px] uppercase tracking-wider">
              Anchored Verbal Evidence Proofs
            </span>
            <div className="space-y-1.5">
              {certificate.evidenceAnchorQuotes.map((q, i) => (
                <div
                  key={i}
                  className="p-2 rounded bg-slate-900/80 border border-slate-800 font-mono text-[11px] text-slate-300"
                >
                  {q}
                </div>
              ))}
            </div>
          </div>

          {/* Cryptographic SHA-256 Fingerprint */}
          <div className="p-3 rounded-lg bg-black/60 border border-slate-800 font-mono">
            <div className="flex items-center space-x-1.5 text-slate-400 text-[11px] mb-1">
              <Hash className="h-3.5 w-3.5 text-accent-cyan" />
              <span>Irrevocable SHA-256 Audit Fingerprint:</span>
            </div>
            <div className="text-[10px] text-accent-cyan break-all tracking-wider">
              {certificate.sha256Fingerprint}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-panel-border bg-slate-900/40 flex items-center justify-between">
          <span className="text-slate-500 text-[11px] font-mono">
            Secured by CALL-E Autonomous Voice Verification Protocol
          </span>
          <button
            onClick={() => window.print()}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-panel hover:bg-panel-hover border border-panel-border transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Print Audit Receipt</span>
          </button>
        </div>
      </div>
    </div>
  );
};
