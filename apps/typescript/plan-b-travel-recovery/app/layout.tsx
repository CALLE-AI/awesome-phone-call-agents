import type { Metadata } from "next";
import "./globals.css";

const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (productionHost ? `https://${productionHost}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "PLAN B — Autonomous Travel Recovery",
  description: "A call-first recovery agent that rebuilds disrupted trips in real time.",
  openGraph: {
    title: "PLAN B — Autonomous Travel Recovery",
    description: "The trip failed. The agent didn’t.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "PLAN B — Autonomous Travel Recovery",
    description: "The trip failed. The agent didn’t.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
