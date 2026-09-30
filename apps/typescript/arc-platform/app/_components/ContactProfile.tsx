import { MapPin, Radio, Users } from "lucide-react";

import LiveCallCard from "@/app/_components/LiveCallCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProvenanceChip } from "@/app/_components/Provenance";

/**
 * The page for a contact we can call but have not written up.
 *
 * The catalogue is 71 contacts; app/radio/_data.ts and _data.ts for creators
 * describe 16 of them in depth - slots, shows, reviews, demographics. The other
 * 55 are real inventory with a name, a city and a number, and nothing else. A
 * plan can now recommend them, so their pages had to stop being 404s.
 *
 * What it deliberately does NOT do is fill the gaps. There are no invented
 * dayparts, no sample reviews, no placeholder audience split. A section we
 * have nothing for is absent, and the page says plainly that the detail is not
 * on file - which is also true of the rate, and is the reason the call button
 * is the most useful thing on the screen.
 */
export interface ContactProfileData {
  externalId: string;
  name: string;
  type: "STATION" | "CREATOR";
  channel: string | null;
  city: string | null;
  frequency: string | null;
  owner: string | null;
  handle: string | null;
  category: string | null;
  audience: number | null;
  audienceBasis: string | null;
  rateEstimatePkr: number | null;
  rateProvenance?: "ESTIMATE" | "SOURCED";
  sourceNote?: string | null;
  phone: string | null;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="type-label text-text-muted">{label}</dt>
      <dd className="type-data text-text">{value}</dd>
    </div>
  );
}

export default function ContactProfile({ contact }: { contact: ContactProfileData }) {
  const isStation = contact.type === "STATION";
  const audience =
    contact.audience == null
      ? "Not on file"
      : `${contact.audience.toLocaleString()} ${contact.audienceBasis ?? ""}`.trim();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-display text-h1 text-text">{contact.name}</h1>
          {contact.frequency && (
            <span className="type-data text-text-muted">{contact.frequency}</span>
          )}
          {contact.handle && <span className="type-data text-text-muted">{contact.handle}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="lilac" className="capitalize">
            {isStation ? "radio" : contact.channel ?? "creator"}
          </Badge>
          {contact.city && (
            <span className="flex items-center gap-1 text-small text-text-muted">
              <MapPin aria-hidden strokeWidth={1.75} className="size-3" />
              {contact.city}
            </span>
          )}
          {contact.category && <span className="text-small text-text-muted">{contact.category}</span>}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isStation ? <Radio aria-hidden strokeWidth={1.75} className="size-4" />
                       : <Users aria-hidden strokeWidth={1.75} className="size-4" />}
            What we hold
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label={contact.audienceBasis ?? "Audience"} value={audience} />
            {contact.owner && <Fact label="Owner" value={contact.owner} />}
            <Fact
              label="Rate"
              /* The whole argument for phoning them, stated where a price
                 would otherwise be invented. */
              value={
                contact.rateEstimatePkr == null
                  ? "Not on file — verify by call"
                  : `PKR ${contact.rateEstimatePkr.toLocaleString()}`
              }
            />
            <Fact label="Number on file" value={contact.phone ? "Yes" : "No — cannot be called"} />
            {contact.rateEstimatePkr != null && (
              <div className="flex flex-col gap-1">
                <dt className="type-label text-text-muted">Rate standing</dt>
                <dd>
                  <ProvenanceChip
                    kind={contact.rateProvenance === "SOURCED" ? "sourced" : "estimate"}
                    note={contact.sourceNote}
                  />
                </dd>
              </div>
            )}
          </dl>

          <p className="mt-5 text-small text-text-muted">
            Dayparts, shows, audience splits and reviews are not on file for this{" "}
            {isStation ? "station" : "creator"} yet. Nothing here is estimated to fill the gap —
            what is missing is missing.
          </p>
        </CardContent>
      </Card>

      <LiveCallCard
        target={{
          name: contact.name,
          type: isStation ? "station" : "creator",
          channel: contact.channel ?? (isStation ? "radio" : undefined),
          externalId: contact.externalId,
          contactName: isStation ? "the ad sales desk" : `${contact.name} or their manager`,
          audienceSize: contact.audience ?? undefined,
          /* Feeds the negotiation mandate. No estimate, no mandate - the call
             then runs as a plain enquiry. See lib/negotiation.ts. */
          estimatePkr: contact.rateEstimatePkr,
        }}
      />
    </div>
  );
}
