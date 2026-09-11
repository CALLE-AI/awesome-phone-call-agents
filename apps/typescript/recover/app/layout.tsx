import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recover — payment failures, caught live",
  description: "Calls customers the moment a payment fails, and gets a real decision instead of a silent email.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
