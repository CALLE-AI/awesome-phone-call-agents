import type { Metadata } from "next";
import CaseFileApp from "./case-file-app";
export const metadata: Metadata = {
  title: "SiteWitness",
  description: "Consent-first evidence gap interviews.",
};
export default function Home() {
  return <CaseFileApp />;
}
