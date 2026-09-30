import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "RelayGoal — the call, made for you. With proof.",
  description:
    "Type a goal; RelayGoal makes the whole phone call and hands you back a verified answer grounded in the exact words that were said. Built for Deaf, hard-of-hearing, and speech-disabled callers.",
  manifest: "/manifest.webmanifest",
  applicationName: "RelayGoal",
  appleWebApp: { capable: true, title: "RelayGoal", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

// Standalone-friendly viewport: fill to the display edges so the full-screen call view
// can paint under a notch, and paint the obsidian theme colour behind the status bar.
export const viewport: Viewport = {
  themeColor: "#15110e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Apply saved accessibility preferences before paint (no flash of wrong theme).
const prefInit = `(function(){try{
  var p = JSON.parse(localStorage.getItem('relaygoal-a11y')||'{}');
  var el = document.documentElement;
  if(p.light) el.classList.add('light');
  if(p.hc) el.classList.add('hc');
  if(p.textsize) el.setAttribute('data-textsize', p.textsize);
  if(p.motion) el.setAttribute('data-motion', p.motion);
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=Geist:wght@300..700&family=Geist+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: prefInit }} />
      </head>
      <body>
        <a href="#main" className="skip-link">Skip to main content</a>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
