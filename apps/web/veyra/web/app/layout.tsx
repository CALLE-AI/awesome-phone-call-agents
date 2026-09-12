import type { Metadata } from 'next';
import { Archivo, Geist } from 'next/font/google';
import './globals.css';
import { cn } from '@/lib/utils';
import { UserProvider } from '@/components/UserProvider';
import { getSessionUser } from '@/lib/supabase/auth';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  weight: ['400', '600', '800'],
});

export const metadata: Metadata = {
  title: 'veyra.web',
  description:
    'Describe an outbound calling process in plain English. Veyra generates an editable voice-agent workflow, compiles it to CALL-E, and runs the calls.',
};

// The user is resolved once here and shared through context, so every client component can
// read it without its own fetch or a logged-out flash. Reading cookies makes the tree
// dynamic, which is what an authenticated app wants anyway.
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const user = await getSessionUser();

  return (
    <html
      lang="en"
      className={cn(
        'h-full',
        'antialiased',
        archivo.variable,
        'font-sans',
        geist.variable,
      )}
    >
      <body className="min-h-full flex flex-col font-sans">
        <UserProvider user={user}>{children}</UserProvider>
      </body>
    </html>
  );
}
