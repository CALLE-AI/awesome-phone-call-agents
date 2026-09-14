import type { Metadata } from "next";
import "./globals.css";

const title = "TinySlot | Verified childcare openings by phone";
const description = "An adaptive CALL-E workflow that verifies childcare openings, compares evidence, and requests a parent-approved tour.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description },
  twitter: { card: "summary_large_image", title, description },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
