'use client';

import { useStore } from '@/lib/store';

export default function BookingConfirmation() {
  const { state } = useStore();

  const activeLoad = state.loads.find((l) => l.id === state.activeLoadId);
  const booking = state.bookings.find((b) => b.loadId === state.activeLoadId);
  const winningQuote = state.quotes.find((q) => q.id === booking?.winningQuoteId);
  const carrier = state.carriers.find((c) => c.id === winningQuote?.carrierId);

  if (!activeLoad || !booking || !winningQuote || !carrier) {
    return null;
  }

  return (
    <div className="mt-6 rounded-lg border-2 border-purple-200 bg-purple-50 p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-600 text-white">
          ✓
        </div>
        <h3 className="text-lg font-semibold text-purple-900">Load Booked</h3>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-md bg-white p-4">
          <div>
            <p className="text-sm text-gray-500">Carrier</p>
            <p className="text-lg font-semibold text-gray-900">{carrier.name}</p>
            {winningQuote.round === 2 && (
              <span className="mt-1 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                Negotiated Rate
              </span>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Final Rate</p>
            <p className="text-2xl font-bold text-purple-700">
              ${booking.finalRate.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 rounded-md bg-white p-4">
          <div>
            <p className="text-xs text-gray-500">Saved vs original quote</p>
            <p className="text-lg font-semibold text-green-600">
              ${booking.savingsVsOriginal.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Saved vs next best</p>
            <p className="text-lg font-semibold text-green-600">
              ${booking.savingsVsNextBest.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="rounded-md bg-white p-4">
          <p className="text-xs text-gray-500">Load Details</p>
          <p className="mt-1 text-sm text-gray-700">
            {activeLoad.origin} → {activeLoad.destination}
          </p>
          <p className="text-sm text-gray-700">
            {activeLoad.equipmentType} • {activeLoad.weight.toLocaleString()} lbs • Pickup: {activeLoad.pickupDate}
          </p>
        </div>

        <div className="rounded-md border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            Booking Reference
          </p>
          <p className="mt-1 font-mono text-sm text-blue-900">{booking.id}</p>
          <p className="mt-1 text-xs text-blue-600">
            Booked at {new Date(booking.timestamp).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
