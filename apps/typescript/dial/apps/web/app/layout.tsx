import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

/**
 * The typeface, self-hosted.
 *
 * `--font-sans` named Inter and nothing ever loaded it, so every screen was
 * quietly rendering in whatever the operating system defaulted to -- Segoe UI on
 * Windows, Helvetica on a Mac -- and the design was never the one anybody
 * designed. next/font builds the files into the bundle rather than fetching
 * them from Google at runtime: one less origin to depend on, no render-blocking
 * request, and `display: swap` with a matched fallback so text is readable
 * immediately and does not jump when the real face arrives.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans-loaded',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'Dial — let Dial make the call for you',
  description:
    'Tell Dial what you need done in the real world. It finds who to contact, calls them, and returns the verified result.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matched to the light and dark canvas so the browser chrome does not flash a
  // different colour behind the app on mobile.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0e14' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
