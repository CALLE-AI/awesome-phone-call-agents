'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { CallResult, CallStatus } from '@/types/campaign';

/** CALL-E has accepted the call and it is dialing or already talking. */
const IN_FLIGHT: CallStatus[] = ['queued', 'in_progress'];

const BARS = [0, 1, 2, 3, 4, 5, 6];

export default function CallInFlight({
  campaignId,
  contactId,
  contactName,
  initialStatus,
}: {
  campaignId: string;
  contactId: string;
  contactName: string;
  initialStatus: CallStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    // Once the terminal webhook lands, re-render the server component so the real
    // result and transcript replace this view.
    if (!IN_FLIGHT.includes(status)) {
      router.refresh();
      return;
    }

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/campaigns/${campaignId}/results`, {
            cache: 'no-store',
          });
          if (!response.ok) return;
          const body = (await response.json()) as { results?: CallResult[] };
          const next = body.results?.find((item) => item.contactId === contactId);
          if (next && next.status !== status) setStatus(next.status);
        } catch {
          // Transient network error — keep polling.
        }
      })();
    }, 3_000);

    return () => window.clearInterval(timer);
  }, [campaignId, contactId, status, router]);

  return (
    <div className="flex flex-col items-center gap-9 border border-bone/[.18] bg-panel px-6 py-14">
      <div className="[perspective:600px]">
        <div className="relative size-40 [transform-style:preserve-3d]">
          <span className="absolute inset-0 animate-call-ring-a rounded-full border-2 border-flame/70 motion-reduce:animate-none" />
          <span className="absolute inset-[14%] animate-call-ring-b rounded-full border-2 border-ember/55 motion-reduce:animate-none" />
          <span className="absolute inset-[28%] animate-call-ring-c rounded-full border border-blush/45 motion-reduce:animate-none" />
          <span className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 animate-call-core rounded-full bg-flame shadow-[0_0_28px_8px_rgba(236,48,19,.5)] motion-reduce:animate-none" />
        </div>
      </div>

      <div className="flex h-8 items-end gap-1.5" aria-hidden="true">
        {BARS.map((index) => (
          <span
            key={index}
            className="h-full w-1.5 origin-bottom animate-call-bar bg-blush/75 motion-reduce:animate-none"
            style={{ animationDelay: `${index * 110}ms` }}
          />
        ))}
      </div>

      <div className="text-center">
        <div className="text-[10.5px] uppercase tracking-[.14em] text-bone/45">
          {status === 'queued' ? 'Dialing' : 'On call'}
        </div>
        <div className="mt-2 text-2xl font-extrabold tracking-[-.01em] text-bone">
          {contactName}
        </div>
        <p className="mt-3 max-w-sm text-[13px] leading-6 text-bone/50">
          {status === 'queued'
            ? 'CALL-E accepted the call and is placing it now.'
            : 'The conversation is in progress.'}{' '}
          This page updates itself as soon as the result arrives.
        </p>
      </div>
    </div>
  );
}
