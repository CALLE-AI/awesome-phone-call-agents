import type { Metadata, Viewport } from "next";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "./globals.css";

const siteUrl = "https://asyncfounders.vercel.app";
const description = "A persistent, source-backed company memory that keeps distributed founders aligned through consented AI phone callbacks.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "AsyncFounders",
  title: { default: "AsyncFounders — Talk once. The company remembers.", template: "%s | AsyncFounders" },
  description,
  keywords: ["distributed founders", "asynchronous collaboration", "team memory", "AI phone agent", "founder alignment", "CALL-E"],
  authors: [{ name: "AsyncFounders" }],
  creator: "AsyncFounders",
  publisher: "AsyncFounders",
  category: "business",
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "AsyncFounders",
    title: "AsyncFounders — Talk once. The company remembers.",
    description,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "AsyncFounders — persistent company memory for distributed teams" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AsyncFounders — Talk once. The company remembers.",
    description,
    images: ["/opengraph-image"],
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#050805", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "AsyncFounders",
    url: siteUrl,
    description,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any",
    image: `${siteUrl}/opengraph-image`,
  };

  return (
    <html lang="en">
      <body>
        {children}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      </body>
    </html>
  );
}
