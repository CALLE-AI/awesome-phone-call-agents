import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppNavigation } from "./AppNavigation";

export const metadata: Metadata = {
  title: "Senior Phone AI",
  description: "A phone-native AI assistant for seniors.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body><AppNavigation /><div id="workspace-content" tabIndex={-1}>{children}</div></body>
    </html>
  );
}
