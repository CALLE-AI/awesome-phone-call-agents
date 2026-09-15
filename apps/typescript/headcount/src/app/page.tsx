import { redirect } from "next/navigation";
import { SEED_EVENT_ID, listEvents } from "@/lib/queries";

export default async function HomePage() {
  const events = await listEvents();
  const first = events[0]?.id ?? SEED_EVENT_ID;
  redirect(`/events/${first}`);
}
