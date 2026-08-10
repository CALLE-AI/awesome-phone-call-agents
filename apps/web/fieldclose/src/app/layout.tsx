import type { Metadata } from "next";
import type { ReactNode } from "react";

import { projectConfig } from "@/config/project";

import "./globals.css";
import "./operations.css";

export const metadata: Metadata = {
  title: {
    default: projectConfig.name,
    template: `%s · ${projectConfig.name}`,
  },
  description: projectConfig.description,
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html data-scroll-behavior="smooth" lang="en">
      <body>
        <a
          className="fixed left-4 top-4 z-50 -translate-y-24 rounded-sm bg-ink px-4 py-3 text-sm font-semibold text-canvas transition-transform focus:translate-y-0"
          href="#main-content"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
