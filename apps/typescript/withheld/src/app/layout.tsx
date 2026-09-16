import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Withheld — never accept a callback',
  description:
    'An errand engine for people who cannot answer a phone. Every leg either finishes the errand or takes a window and calls back itself.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
