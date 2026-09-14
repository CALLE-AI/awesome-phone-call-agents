import type { Metadata } from "next";
import { ReadyLineApp } from "./ReadyLineApp";

export const metadata: Metadata = {
  title: "ReadyLine — Event load-in readiness",
  description:
    "Confirm vendor plans, catch load-in conflicts, and coordinate a safe resolution before event day.",
};

export default function Home() {
  return <ReadyLineApp />;
}
