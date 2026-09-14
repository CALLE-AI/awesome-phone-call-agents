import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VaultCall — Autonomous Out-of-Band BEC Wire Defense',
  description:
    'Protecting enterprise treasury from $55B+ BEC wire fraud using CALL-E autonomous voice verification protocols.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
