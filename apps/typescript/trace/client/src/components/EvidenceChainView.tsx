import React from 'react';
import {
  FileText,
  PhoneCall,
  Database,
  GitCompare,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  PhoneOff,
  AlertCircle,
  Lightbulb,
  ShieldCheck,
} from 'lucide-react';
import { EvidenceChain, ReviewStatus, VerificationOutcome } from '../types/index.js';

interface EvidenceChainViewProps {
  evidenceChain: EvidenceChain;
  reviewStatus?: ReviewStatus;
}

export const EvidenceChainView: React.FC<EvidenceChainViewProps> = ({
  evidenceChain,
  reviewStatus,
}) => {
  const getOutcomeBadge = (outcome: VerificationOutcome, review?: ReviewStatus) => {
    switch (outcome) {
      case 'VERIFIED':
        return {
          icon: <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />,
          bg: 'bg-[#F0FDF4] border-[#86EFAC] text-[#166534]',
          title: 'VERIFIED',
          desc: 'Physical reality confirms digital claim.',
        };
      case 'CONTRADICTED':
        return {
          icon: <AlertTriangle className="w-4 h-4 text-[#DC2626]" />,
          bg: 'bg-[#FEF2F2] border-[#FCA5A5] text-[#991B1B]',
          title: 'CONTRADICTED',
          desc: 'Discrepancy detected between claim and phone reality.',
        };
      case 'UNREACHABLE':
        return {
          icon: <PhoneOff className="w-4 h-4 text-[#64748B]" />,
          bg: 'bg-[#F1F5F9] border-[#CBD5E1] text-[#334155]',
          title: 'UNREACHABLE',
          desc: 'Target supplier line could not be reached.',
        };
      case 'UNKNOWN / INCONCLUSIVE':
      default:
        return {
          icon: <HelpCircle className="w-4 h-4 text-[#D97706]" />,
          bg: 'bg-[#FFFBEB] border-[#FCD34D] text-[#92400E]',
          title: 'UNKNOWN / INCONCLUSIVE',
          desc: review === 'NEEDS_REVIEW' ? 'Audit required: ambiguous supplier response.' : 'Inconclusive evidence.',
        };
    }
  };

  const outcomeConfig = getOutcomeBadge(evidenceChain.outcome, reviewStatus || evidenceChain.reviewStatus);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      {/* Header Banner */}
      <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-600">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F172A]">
              Deterministic Evidence Chain
            </h3>
            <p className="text-[11px] text-[#475569]">
              End-to-end verification pipeline from source claim to actionable recommendation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {evidenceChain.difference && (
            <span className="px-2.5 py-1 text-[11px] font-mono font-bold rounded-full bg-amber-50 text-amber-800 border border-amber-300">
              Δ {evidenceChain.difference}
            </span>
          )}
          <span
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border ${outcomeConfig.bg}`}
          >
            {outcomeConfig.icon}
            {outcomeConfig.title}
          </span>
          {(reviewStatus === 'NEEDS_REVIEW' || evidenceChain.reviewStatus === 'NEEDS_REVIEW') && (
            <span className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-full bg-[#FFFBEB] text-[#92400E] border border-[#FCD34D] uppercase tracking-wide">
              <AlertCircle className="w-3 h-3 text-[#D97706]" /> Needs Review
            </span>
          )}
        </div>
      </div>

      {/* Pipeline Stages Grid */}
      <div className="p-5 space-y-4">
        {/* Stages 1 to 4: Step-by-Step Flow */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Step 1: Source Claim */}
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#475569] mb-1.5">
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                <span>1. Source / Digital Claim</span>
              </div>
              <p className="text-xs text-[#0F172A] leading-relaxed font-sans">
                {evidenceChain.sourceClaim || 'Direct phone inquiry (no digital claim provided).'}
              </p>
            </div>
          </div>

          {/* Step 2: Phone Evidence */}
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#475569] mb-1.5">
                <PhoneCall className="w-3.5 h-3.5 text-emerald-600" />
                <span>2. Phone Audio Evidence</span>
              </div>
              <p className="text-xs text-[#0F172A] leading-relaxed italic">
                "{evidenceChain.phoneEvidence || 'No response captured'}"
              </p>
            </div>
          </div>

          {/* Step 3: Structured Facts */}
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#475569] mb-1.5">
                <Database className="w-3.5 h-3.5 text-purple-600" />
                <span>3. Extracted Facts</span>
              </div>
              <div className="space-y-1 text-xs font-mono text-slate-800">
                {evidenceChain.structuredFact?.availableQuantity !== undefined &&
                  evidenceChain.structuredFact.availableQuantity !== null && (
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Qty:</span>
                      <span className="font-semibold text-purple-700">
                        {evidenceChain.structuredFact.availableQuantity}
                      </span>
                    </div>
                  )}
                {evidenceChain.structuredFact?.confirmedDeliveryDate && (
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Date:</span>
                    <span className="text-purple-700">
                      {evidenceChain.structuredFact.confirmedDeliveryDate}
                    </span>
                  </div>
                )}
                {evidenceChain.structuredFact?.confirmedLeadTime && (
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Lead Time:</span>
                    <span className="text-purple-700">
                      {evidenceChain.structuredFact.confirmedLeadTime}
                    </span>
                  </div>
                )}
                {evidenceChain.structuredFact?.confirmedUnitPrice && (
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Price:</span>
                    <span className="text-purple-700">
                      {evidenceChain.structuredFact.confirmedUnitPrice}
                    </span>
                  </div>
                )}
                {evidenceChain.structuredFact?.contactName && (
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Contact:</span>
                    <span className="text-slate-800">
                      {evidenceChain.structuredFact.contactName}
                    </span>
                  </div>
                )}
                {Object.keys(evidenceChain.structuredFact || {}).length === 0 && (
                  <span className="text-slate-400 italic text-[11px]">No facts extracted</span>
                )}
              </div>
            </div>
          </div>

          {/* Step 4: Deterministic Comparison */}
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#475569] mb-1.5">
                <GitCompare className="w-3.5 h-3.5 text-amber-600" />
                <span>4. Delta Reconciliation</span>
              </div>
              <p className="text-xs text-[#0F172A] leading-relaxed font-sans">
                {evidenceChain.comparison || 'Reconciliation executed.'}
              </p>
            </div>
          </div>
        </div>

        {/* Steps 5, 6, 7: Impact & Operational Recommendation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
          {/* Operational Impact */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-600 shrink-0 mt-0.5">
              <AlertCircle className="w-4 h-4" />
            </div>
            <div className="space-y-1 flex-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#475569]">
                Operational Impact
              </span>
              <p className="text-xs text-[#0F172A] leading-relaxed">
                {evidenceChain.operationalImpact || 'No immediate operational impact identified.'}
              </p>
            </div>
          </div>

          {/* Recommended Action */}
          <div className="p-4 bg-[#EFF6FF] rounded-xl border border-[#BFDBFE] flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-100 border border-blue-200 text-blue-600 shrink-0 mt-0.5">
              <Lightbulb className="w-4 h-4" />
            </div>
            <div className="space-y-1 flex-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#1E3A8A]">
                Actionable Recommendation
              </span>
              <p className="text-xs text-[#1E3A8A] leading-relaxed font-medium">
                {evidenceChain.recommendation || 'Proceed with standard operational workflows.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
