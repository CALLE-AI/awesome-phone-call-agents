import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ChargeCheck",
  description: "Don't trust the map. Call the station.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
