import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clarity",
  description:
    "Turn polished-but-vague job applications into precise, evidence-backed facts through one short adaptive phone call.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
