import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  const title = "Bellwrench — Evidence-backed vendor dispatch";
  const description =
    "Call an authorized maintenance roster with CALL-E, compare structured evidence, and keep the dispatch decision human.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: image, width: 1732, height: 909, alt: "Bellwrench dispatch routing card" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
