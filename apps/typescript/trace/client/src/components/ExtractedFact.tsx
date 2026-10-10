import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Quote } from 'lucide-react';
import { StructuredCallResult, VerificationQuestion } from '../types/index.js';

interface ExtractedFactProps {
  structuredResult: StructuredCallResult | null;
  questions?: VerificationQuestion[];
}

export const ExtractedFact: React.FC<ExtractedFactProps> = ({
  structuredResult,
}) => {
  const [showEvidence, setShowEvidence] = useState(false);

  if (!structuredResult) {
    return null;
  }

  // Build key fact rows from structuredResult
  const rows: { label: string; value: string; confidence?: string }[] = [];

  if (structuredResult.quantity_or_capacity) {
    rows.push({
      label: 'Available Quantity',
      value: structuredResult.quantity_or_capacity,
      confidence: structuredResult.verification_confidence,
    });
  } else if (structuredResult.availability_status) {
    rows.push({
      label: 'Availability',
      value:
        structuredResult.availability_status === 'available'
          ? 'Confirmed Available'
          : structuredResult.availability_status === 'unavailable'
          ? 'Unavailable / Out of stock'
          : structuredResult.availability_status === 'limited'
          ? 'Limited / Conditional'
          : 'Unverified / Inconclusive',
      confidence: structuredResult.verification_confidence,
    });
  }

  if (structuredResult.next_available_time) {
    rows.push({
      label: 'Delivery / Timing',
      value: structuredResult.next_available_time,
      confidence: structuredResult.verification_confidence,
    });
  }

  if (structuredResult.lead_time) {
    rows.push({
      label: 'Lead Time',
      value: structuredResult.lead_time,
      confidence: structuredResult.verification_confidence,
    });
  }

  if (structuredResult.unit_price) {
    rows.push({
      label: 'Unit Price',
      value: structuredResult.unit_price,
      confidence: structuredResult.verification_confidence,
    });
  }

  if (structuredResult.contact_name) {
    rows.push({
      label: 'Representative',
      value: structuredResult.contact_name,
      confidence: structuredResult.verification_confidence,
    });
  }

  const evidenceQuotes = structuredResult.evidence || [];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#0F172A]">
          Key Verified Facts
        </h4>
        {structuredResult.verification_confidence && (
          <span className="text-[11px] font-semibold text-[#475569] capitalize">
            {structuredResult.verification_confidence} Confidence
          </span>
        )}
      </div>

      {/* Row-based Fact Table */}
      <div className="divide-y divide-slate-100 text-xs">
        {rows.map((row, idx) => (
          <div key={idx} className="py-2 flex items-center justify-between gap-3">
            <span className="text-[#475569] font-medium">{row.label}</span>
            <span className="text-[#0F172A] font-semibold text-right">{row.value}</span>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="py-2 text-slate-400 italic">No structured attributes verified.</div>
        )}
      </div>

      {/* Progressive Disclosure: View Evidence */}
      {evidenceQuotes.length > 0 && (
        <div className="pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={() => setShowEvidence(!showEvidence)}
            className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-semibold transition-colors cursor-pointer"
          >
            {showEvidence ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" /> Hide Evidence
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" /> View Evidence ({evidenceQuotes.length})
              </>
            )}
          </button>

          {showEvidence && (
            <div className="mt-2.5 space-y-2 text-xs">
              {evidenceQuotes.map((quote, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-start gap-2 text-slate-700 italic"
                >
                  <Quote className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span>"{quote.replace(/^\[MOCK DEMO\]\s*/i, '')}"</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
