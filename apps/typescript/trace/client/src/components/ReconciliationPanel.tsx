import React from 'react';
import { ShieldCheck, ShieldAlert, PhoneOff, HelpCircle, AlertCircle } from 'lucide-react';
import { DigitalClaim, ReconciliationOutcome, StructuredCallResult, ReviewStatus, VerificationOutcome } from '../types/index.js';

interface ReconciliationPanelProps {
  digitalClaim?: DigitalClaim;
  structuredResult: StructuredCallResult | null;
  reconciliation: ReconciliationOutcome | null;
  reviewStatus?: ReviewStatus;
}

export const ReconciliationPanel: React.FC<ReconciliationPanelProps> = ({
  digitalClaim,
  reconciliation,
  reviewStatus,
}) => {
  if (!reconciliation) {
    return null;
  }

  const outcome: VerificationOutcome = reconciliation.outcome;
  const isNeedsReview = reviewStatus === 'NEEDS_REVIEW' || reconciliation.reviewStatus === 'NEEDS_REVIEW';

  // Format Outcome Styling
  const getOutcomeStyle = () => {
    switch (outcome) {
      case 'VERIFIED':
        return {
          title: 'VERIFIED',
          icon: <ShieldCheck className="w-4 h-4 text-[#16A34A]" />,
          badgeClass: 'bg-[#F0FDF4] text-[#166534] border-[#86EFAC]',
        };
      case 'CONTRADICTED':
        return {
          title: 'CONTRADICTED',
          icon: <ShieldAlert className="w-4 h-4 text-[#DC2626]" />,
          badgeClass: 'bg-[#FEF2F2] text-[#991B1B] border-[#FCA5A5]',
        };
      case 'UNREACHABLE':
        return {
          title: 'UNREACHABLE',
          icon: <PhoneOff className="w-4 h-4 text-[#64748B]" />,
          badgeClass: 'bg-[#F1F5F9] text-[#334155] border-[#CBD5E1]',
        };
      case 'UNKNOWN / INCONCLUSIVE':
      default:
        return {
          title: 'UNKNOWN / INCONCLUSIVE',
          icon: <HelpCircle className="w-4 h-4 text-[#D97706]" />,
          badgeClass: 'bg-[#FFFBEB] text-[#92400E] border-[#FCD34D]',
        };
    }
  };

  const style = getOutcomeStyle();

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3.5 shadow-xs">
      {/* Header & Prominent Result Badge */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <span className="text-xs font-bold uppercase tracking-wider text-[#475569]">
          {digitalClaim ? 'Reconciliation Result' : 'Phone Verification Result'}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full border tracking-wide ${style.badgeClass}`}
          >
            {style.icon}
            {style.title}
          </span>
          {isNeedsReview && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#FFFBEB] text-[#92400E] border border-[#FCD34D] uppercase">
              <AlertCircle className="w-3 h-3 text-[#D97706]" /> Review Required
            </span>
          )}
        </div>
      </div>

      {/* Comparison Statement if digital claim was provided */}
      {digitalClaim && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-2">
          <div className="flex items-center justify-between font-mono">
            <span className="text-[#475569]">Source Claim:</span>
            <span className="text-[#0F172A] font-semibold">
              {digitalClaim.expectedQuantity !== undefined
                ? `${digitalClaim.expectedQuantity} units`
                : digitalClaim.claimedStatus}
            </span>
          </div>
          <div className="flex items-center justify-between font-mono">
            <span className="text-[#475569]">Phone Verified:</span>
            <span className="text-purple-700 font-semibold">
              {reconciliation.evidenceChain?.structuredFact?.availableQuantity &&
              reconciliation.evidenceChain.structuredFact.availableQuantity !== 'Unconfirmed'
                ? typeof reconciliation.evidenceChain.structuredFact.availableQuantity === 'number' ||
                  /^\d+$/.test(String(reconciliation.evidenceChain.structuredFact.availableQuantity))
                  ? `${reconciliation.evidenceChain.structuredFact.availableQuantity} units`
                  : String(reconciliation.evidenceChain.structuredFact.availableQuantity)
                : outcome === 'UNKNOWN / INCONCLUSIVE'
                ? 'Not established'
                : 'Unconfirmed'}
            </span>
          </div>
          {reconciliation.difference && (
            <div className="flex items-center justify-between font-mono pt-1.5 border-t border-slate-200">
              <span className="text-[#475569]">Difference:</span>
              <span className="text-amber-800 font-bold">{reconciliation.difference}</span>
            </div>
          )}
        </div>
      )}

      {/* Unreachable Summary */}
      {outcome === 'UNREACHABLE' && (
        <div className="text-xs text-slate-600 leading-relaxed">
          No successful audio connection could be established with the target supplier.
        </div>
      )}

      {/* Operational Impact (if any) */}
      {reconciliation.operationalImpact && (
        <div className="text-xs space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#475569] block">
            Operational Impact
          </span>
          <p className="text-slate-700 leading-relaxed">
            {reconciliation.operationalImpact}
          </p>
        </div>
      )}

      {/* Actionable Recommendation */}
      {reconciliation.recommendation && (
        <div className="p-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg text-xs space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#1E3A8A] block">
            Recommendation
          </span>
          <p className="text-[#1E3A8A] leading-relaxed font-medium">
            {reconciliation.recommendation}
          </p>
        </div>
      )}
    </div>
  );
};
