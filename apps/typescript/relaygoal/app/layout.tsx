import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RelayGoal — the call, made for you. With proof.",
  description:
    "Type a goal; RelayGoal makes the whole phone call and hands you back a verified answer grounded in the exact words that were said. Built for Deaf, hard-of-hearing, and speech-disabled callers.",
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
      </body>
    </html>
  );
}
