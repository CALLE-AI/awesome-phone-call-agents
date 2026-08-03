import type { Metadata } from "next";
import "./globals.css";
import "bootstrap/dist/css/bootstrap.min.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Voxra — Your AI Voice Agent",
  description:
    "Voxra is a professional AI voice agent platform powered by CALL-E. Delegate any phone call — describe your goal and let the agent handle the conversation.",
  keywords: ["AI voice agent", "phone calls", "automation", "Voxra", "CALL-E"],
  openGraph: {
    title: "Voxra — AI Voice Agent Platform",
    description: "Let your AI voice agent make real phone calls on your behalf. Powered by CALL-E.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
