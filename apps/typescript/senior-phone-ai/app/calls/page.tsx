import { CallMonitor } from "./CallMonitor";

export const metadata = { title: "Phone call monitor | Senior Phone AI" };

export default function CallsPage() {
  return <main>
    <CallMonitor previewSms={process.env.CALLE_FOLLOWUP_PREVIEW === "true"} />
  </main>;
}
