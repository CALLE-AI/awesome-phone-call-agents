import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wever Callback | Inquiry inbox",
  description: "Follow up on warm customer inquiries, review conversations, and move the right opportunities forward.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
