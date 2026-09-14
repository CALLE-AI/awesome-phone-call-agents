import type { Metadata } from "next";
import HumanInterviewWorkspace from "./workspace";

export const metadata: Metadata = {
  title: "Human interview · 47 Baker Street · SiteWitness",
  description: "Record a bounded human-led interview for the 47 Baker Street evidence request.",
  openGraph: { title: "Human interview · 47 Baker Street", description: "Record a bounded human-led SiteWitness interview.", images: [] },
  twitter: { title: "Human interview · 47 Baker Street", description: "Record a bounded human-led SiteWitness interview.", images: [] },
};

export default async function HumanInterviewPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return <HumanInterviewWorkspace taskId={taskId} />;
}
