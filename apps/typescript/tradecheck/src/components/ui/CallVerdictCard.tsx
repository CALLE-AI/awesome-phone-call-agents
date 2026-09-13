import React from 'react';
import { Card } from './Card';
import { Badge } from './Badge';
import { CalleResult } from '@/lib/calle';

const VERDICT_CONFIG = {
  verified_reachable: {
    label: 'Verified & Reachable',
    badgeVariant: 'verified' as const,
    icon: '✓',
    bgAccent: 'border-l-4 border-l-success',
  },
  discrepancy_found: {
    label: 'Discrepancy Found',
    badgeVariant: 'discrepancy' as const,
    icon: '⚠',
    bgAccent: 'border-l-4 border-l-warning',
  },
  could_not_verify: {
    label: 'Could Not Verify',
    badgeVariant: 'unverified' as const,
    icon: '?',
    bgAccent: 'border-l-4 border-l-gray-400',
  },
};

export function CallVerdictCard({
  data,
  loading,
  claimedTerms,
  onViewTranscript,
}: {
  data?: CalleResult | null;
  loading?: boolean;
  claimedTerms?: string;
  onViewTranscript?: () => void;
}) {
  if (loading) {
    return (
      <Card variant="standard" className="flex flex-col items-center justify-center p-8 h-52">
        <div className="relative w-8 h-8 mb-4">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
        </div>
        <span className="text-primary-text text-sm font-medium">Calling supplier...</span>
        <span className="text-secondary-text text-xs mt-1">This may take up to 60 seconds</span>
      </Card>
    );
  }

  if (!data) return null;

  const config = VERDICT_CONFIG[data.verdict];

  return (
    <Card variant="standard" className={`flex flex-col gap-4`}>
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2">
          <span className="text-xl">{config.icon}</span>
          <h3 className="text-base font-bold text-primary-text">Live Call Verdict</h3>
        </div>
        <Badge variant={config.badgeVariant}>{config.label}</Badge>
      </div>

      {/* Terms Comparison */}
      {(claimedTerms || data.stated_price_or_terms) && (
        <div className="bg-gray-50 rounded-md p-3 text-xs flex flex-col gap-2">
          <div className="font-medium text-secondary-text uppercase tracking-wide mb-1">Terms Comparison</div>
          {claimedTerms && (
            <div className="flex gap-2">
              <span className="text-secondary-text w-16 flex-shrink-0">Claimed:</span>
              <span className="text-primary-text">{claimedTerms}</span>
            </div>
          )}
          {data.stated_price_or_terms && (
            <div className="flex gap-2">
              <span className="text-secondary-text w-16 flex-shrink-0">Stated:</span>
              <span className="text-primary-text font-medium">{data.stated_price_or_terms}</span>
            </div>
          )}
        </div>
      )}

      {/* Evidence fields */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-secondary-text text-xs block mb-0.5">Business Reached</span>
          <span className="text-primary-text font-medium capitalize">{data.reached_business}</span>
        </div>
        {data.advance_payment_requested && (
          <div>
            <span className="text-secondary-text text-xs block mb-0.5">Advance Payment</span>
            <span className="text-primary-text font-medium">{data.advance_payment_requested}</span>
          </div>
        )}
      </div>

      {/* Red Flags */}
      {data.red_flags && data.red_flags.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
          <div className="text-xs font-medium text-yellow-800 mb-2">Red Flags</div>
          <ul className="text-xs text-yellow-900 space-y-1 list-disc list-inside">
            {data.red_flags.map((flag, i) => (
              <li key={i}>{flag}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Confidence & Transcript */}
      <div className="flex justify-between items-center pt-2 border-t border-gray-100">
        <div className="text-xs text-secondary-text">
          Confidence: <span className="font-semibold text-primary-text">{data.confidence ?? '—'}%</span>
        </div>
        {data.transcript && onViewTranscript && (
          <button
            onClick={onViewTranscript}
            className="text-xs text-black underline underline-offset-2 hover:text-gray-600 transition-colors"
          >
            View full transcript →
          </button>
        )}
      </div>
    </Card>
  );
}
