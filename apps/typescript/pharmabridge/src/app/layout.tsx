import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Sora } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "PharmaBridge: critical medicine and blood, found by phone",
  description:
    "PharmaBridge dispatches CALL-E voice agents to nearby pharmacies and blood banks in parallel, verifies what is actually available, and secures a hold.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
