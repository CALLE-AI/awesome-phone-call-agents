import type { Metadata } from "next";
import DemoClient from "./demo-client";

export const metadata: Metadata = {
  title: "Noon Arch AI Operations — No-call Demo",
  description: "A safe, credential-free replay of Noon Arch AI Operations phone workflows.",
};

export default function DemoPage() {
  return <DemoClient />;
}
