import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PourReady · Pre-pour coordination gate',
  description:
    'Expose conflicting verbal commitments before concrete trucks move.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
