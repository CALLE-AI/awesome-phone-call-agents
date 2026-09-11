import type { Metadata } from "next";
import { PublicPage } from "../components/site-chrome";
import { HistoryLedger } from "./history-ledger";

export const metadata: Metadata = {
  title: "SpareScout Request History",
  description: "Revisit locally authorized sourcing requests, call runs, and evidence-backed supplier quotes.",
};

export default function HistoryPage() {
  return (
    <PublicPage
      eyebrow="Private request history"
      title="Your sourcing ledger."
      intro="This browser can reopen only the requests it created. Every server record requires its separate history credential, and supplier numbers remain masked."
    >
      <HistoryLedger />
    </PublicPage>
  );
}
