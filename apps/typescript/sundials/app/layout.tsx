import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Instrument_Serif, Inter } from "next/font/google";
import { ThemeProvider } from "@/lib/console/ThemeProvider";
import { THEME_BOOTSTRAP } from "@/lib/console/theme";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const harborSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-harbor-serif"
});

export const metadata: Metadata = {
  title: "Sundials Intelligence",
  description: "Call while your lead is warm. Agentic inbound intent and high-quality discovery calls."
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", inter.variable, harborSerif.variable)}>
      <head>
        <link rel="icon" type="image/png" href="/sundials-mark.png?v=2" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="antialiased min-h-screen bg-background text-foreground">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
