import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChangeLock — vendor payment-change verification",
  description:
    "Accounts-payable fraud command center. Independently verifies vendor payment-detail change requests by phone without ever approving or executing a financial change.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              ChangeLock <span>/ accounts-payable fraud command center</span>
            </div>
            <div className="mode-tag">
              {process.env.CHANGELOCK_MODE === "live"
                ? "Local live mode — external call enabled"
                : "Judge replay mode — no live calls"}
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
