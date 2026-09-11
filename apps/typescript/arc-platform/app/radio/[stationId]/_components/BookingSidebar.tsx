"use client";

import { useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";

import type { TimeSlot } from "../../_data";
import LiveCallCard from "@/app/_components/LiveCallCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export interface BrandCampaign {
  id: string;
  name: string;
}

/** Availability tone as a token NAME - the same map the directory uses, so a
 *  slot reads identically on the card and here. */
const AVAILABILITY: Record<TimeSlot["availability"], { variant: "lilac" | "butter" | "muted"; label: string }> = {
  available: { variant: "lilac",  label: "Available" },
  limited:   { variant: "butter", label: "Limited" },
  full:      { variant: "muted",  label: "Full" },
};

function MiniCalendar({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (iso: string) => void;
}) {
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  /* There used to be a bookedDays set of [4, 11, 18, 25] here, rendered
     struck through and disabled - invented unavailability on a real station's
     calendar. Arc holds no per-date availability, so every future date is
     selectable and the station confirms. */

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
        >
          <ChevronLeft aria-hidden strokeWidth={2} />
        </Button>
        <span className="text-small font-medium text-text">{monthLabel}</span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next month"
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
        >
          <ChevronRight aria-hidden strokeWidth={2} />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="type-label py-1 text-center text-text-muted">{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const date = new Date(year, month, day);
          const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isSel = selected.includes(iso);

          return (
            <button
              key={i}
              type="button"
              disabled={isPast}
              aria-pressed={isSel}
              onClick={() => onToggle(iso)}
              className={`rounded-control py-1.5 type-data outline-none transition-colors focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none ${
                isSel ? "bg-primary text-primary-fg"
                : isPast ? "cursor-not-allowed text-hairline"
                : "text-text hover:bg-lilac/50"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  slots: TimeSlot[];
  stationName: string;
  stationId: string;
  city: string;
  campaigns: BrandCampaign[];
}

export default function BookingSidebar({ slots, stationName, stationId, city, campaigns }: Props) {
  const [campaign, setCampaign] = useState("");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [booked, setBooked] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ spots: number; total: number | null; dates: number } | null>(null);

  function toggleDate(iso: string) {
    setSelectedDates(v => v.includes(iso) ? v.filter(d => d !== iso) : [...v, iso]);
  }

  function toggleSlot(id: string) {
    setSelectedSlots(v => v.includes(id) ? v.filter(s => s !== id) : [...v, id]);
  }

  const selectedSlotData = slots.filter(s => selectedSlots.includes(s.id));
  const spotsTotal = selectedSlotData.length * Math.max(selectedDates.length, 1);

  /* priceBase is the station's real rate for the slot. The duration selector
     that multiplied it by 0.5 / 1.25 / 1.45 is gone - those rules exist
     nowhere in the catalogue. So is the estimated reach line, which valued
     every spot on every station at a flat 210,000 listeners. */
  const baseTotal = selectedSlotData.reduce((sum, s) => sum + s.priceBase, 0) * Math.max(selectedDates.length, 1);
  const platformFee = Math.round(baseTotal * 0.1);
  const total = baseTotal + platformFee;

  /* Was a 1.5s setTimeout that claimed the spots were reserved and wrote
     nothing. It writes now, and the confirmation states only what came back. */
  async function handleBook() {
    if (!selectedSlots.length || !campaign) return;
    setBooking(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaign,
          externalId: stationId,
          kind: "STATION",
          name: stationName,
          channel: "radio",
          city,
          dates: selectedDates,
          slots: selectedSlotData.map(s => s.label.replace(/^[^A-Za-z]+/, "")),
          ratePkr: selectedSlotData.length
            ? Math.round(selectedSlotData.reduce((sum, s) => sum + s.priceBase, 0) / selectedSlotData.length)
            : null,
          spots: spotsTotal,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Booking failed.");
      setSaved({ spots: data.spots, total: data.bookedTotalPkr, dates: (data.dates ?? []).length });
      setBooked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBooking(false);
    }
  }

  if (booked) {
    return (
      <Card size="sm">
        <CardContent className="flex flex-col items-center gap-4 text-center">
          <h3 className="font-display text-h2 text-text">Booking saved</h3>
          {/* Says what is now in the plan and nothing more. The old copy
              promised the spots were reserved and that "the station team will
              confirm within 24 hours" - there is no station team in the loop
              and nothing notifies anyone. */}
          <p className="text-small leading-relaxed text-text-muted">
            {saved?.spots ?? spotsTotal} spot{(saved?.spots ?? spotsTotal) !== 1 ? "s" : ""} on{" "}
            <strong className="font-medium text-text">{stationName}</strong>
            {saved?.dates ? ` across ${saved.dates} date${saved.dates !== 1 ? "s" : ""}` : ""} added to
            your campaign&apos;s media plan.
          </p>
          {saved?.total != null && (
            <div className="flex w-full flex-col gap-1 rounded-control bg-bone p-4">
              <span className="type-label text-text-muted">Booked total</span>
              <span className="font-display text-h2 leading-none text-text">PKR {saved.total.toLocaleString()}</span>
            </div>
          )}
          <Button variant="outline" onClick={() => { setBooked(false); setSaved(null); }}>Book More Slots</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* externalId, or this card can never find a number. Without it the
          server has nothing to look up in the Contact table or ARC_CONTACTS,
          and in production - where there is no demo fallback - every station
          page showed NO PHONE however the contacts were configured. */}
      <LiveCallCard
        target={{
          name: stationName,
          type: "station",
          channel: "radio",
          externalId: stationId,
          contactName: "the ad sales desk",
        }}
      />

      <Card size="sm">
        <CardHeader>
          <CardTitle>Book {stationName}</CardTitle>
          <CardDescription>Self-serve · Instant confirmation</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="booking-campaign">Campaign (required)</Label>
            <select
              id="booking-campaign"
              value={campaign}
              onChange={e => setCampaign(e.target.value)}
              className="h-10 rounded-control border border-border bg-surface px-3 text-small text-text outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value="">Select a campaign</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {/* A booking has to belong to a campaign - MediaPlanItem is filed
                under one, and there is nowhere honest to put one that is not. */}
            <p className="text-small text-text-muted">
              A booking is added to a campaign&apos;s media plan, so pick the campaign it belongs to.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <span className="type-label text-text-muted">Dates &amp; Time Slots</span>
            <MiniCalendar selected={selectedDates} onToggle={toggleDate} />
            {selectedDates.length > 0 && (
              <p className="text-small text-text-muted">
                {selectedDates.length} date{selectedDates.length !== 1 ? "s" : ""} selected — choose time slots below
              </p>
            )}

            <div className="flex flex-col gap-2">
              {slots.map(slot => {
                const isSel = selectedSlots.includes(slot.id);
                const isFull = slot.availability === "full";
                const avail = AVAILABILITY[slot.availability];
                return (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={isFull}
                    aria-pressed={isSel}
                    onClick={() => toggleSlot(slot.id)}
                    className={`flex items-center justify-between gap-3 rounded-control p-3 text-left outline-none transition-colors focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none ${
                      isFull ? "cursor-not-allowed bg-bone text-text-muted"
                      : isSel ? "bg-lilac text-ink"
                      : "cursor-pointer bg-bone text-text hover:bg-lilac/50"
                    }`}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-2 text-small font-medium">
                        {/* The label carries a ⚡ glyph in the data; isPrime
                            is the field that means it. */}
                        {slot.label.replace(/^[^A-Za-z]+/, "")}
                        {slot.isPrime && <Badge variant="butter">Prime</Badge>}
                      </span>
                      <span className="type-data text-text-muted">{slot.time}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="type-data">PKR {slot.priceBase.toLocaleString()}</span>
                      <span className="text-small text-text-muted">
                        {slot.slotsLeft ? `${slot.slotsLeft} left` : avail.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedSlotData.length > 0 && (
            <div className="flex flex-col gap-3">
              <span className="type-label text-text-muted">Price Breakdown</span>
              {selectedSlotData.map(slot => (
                <div key={slot.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-small text-text-muted">
                    {Math.max(selectedDates.length, 1)} × {slot.label.replace(/^[^A-Za-z]+/, "")}
                  </span>
                  <span className="type-data text-text">
                    PKR {(slot.priceBase * Math.max(selectedDates.length, 1)).toLocaleString()}
                  </span>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-small text-text-muted">Arc platform fee (10%)</span>
                <span className="type-data text-text">PKR {platformFee.toLocaleString()}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-3">
                <span className="text-small font-medium text-text">Total</span>
                <span className="type-data font-medium text-text">PKR {total.toLocaleString()}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 rounded-control bg-danger-bg p-4" role="alert">
              <TriangleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-danger" />
              <p className="text-small leading-relaxed text-danger">{error}</p>
            </div>
          )}

          <Button onClick={handleBook} disabled={booking || !selectedSlots.length || !campaign}>
            {booking
              ? "Booking…"
              : !campaign
                ? "Select a campaign to book"
                : selectedSlots.length
                  ? <>Book This Station <ArrowRight aria-hidden strokeWidth={1.75} /></>
                  : "Select slots to book"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
