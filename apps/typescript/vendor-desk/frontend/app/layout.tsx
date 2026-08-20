import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VendorDesk — Autonomous Procurement Agent",
  description: "Call vendors, compare quotes, buy smarter — powered by CALL-E.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
