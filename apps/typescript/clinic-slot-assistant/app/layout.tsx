import type { Metadata } from 'next';
import './globals.css';
import './recovery.css';
export const metadata: Metadata = {title: 'Clinic Slot Assistant · A little less waiting', description: 'A CALL-E hackathon prototype for filling cancelled appointments with staff-reviewed phone responses.'};
export default function RootLayout({ children }: {children: React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
