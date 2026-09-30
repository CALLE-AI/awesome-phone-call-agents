import RespondentForm from "./respondent-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Secure response · 47 Baker Street · SiteWitness",
  description: "Provide a scoped factual response for the 47 Baker Street evidence request.",
  openGraph: { title: "Secure response · 47 Baker Street", description: "Provide a scoped factual response for the SiteWitness evidence request.", images: [] },
  twitter: { title: "Secure response · 47 Baker Street", description: "Provide a scoped factual response for the SiteWitness evidence request.", images: [] },
};

export default async function RespondPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RespondentForm token={token} />;
}
