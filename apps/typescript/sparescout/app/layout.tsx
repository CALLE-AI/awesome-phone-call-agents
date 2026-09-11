import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "SpareScout — Phone-powered parts sourcing",
    description: "Call multiple auto-parts dealers, verify fitment, and compare structured quotes in one safe workflow.",
    openGraph: {
      title: "SpareScout",
      description: "The right part. One round of calls.",
      images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "SpareScout — The right part. One round of calls." }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "SpareScout",
      description: "The right part. One round of calls.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
