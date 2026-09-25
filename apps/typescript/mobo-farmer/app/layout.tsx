import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MoboFarmer Dashboard",
  description: "Your Farm Calls For Itself",
};

import Header from "@/components/Header";

export default function RootLayout({ children }: { children: React.ReactNode })
{
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans text-[#2B1D12] relative">
        {/* Background Image */}
        <div 
          className="fixed inset-0 z-[-2] bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url('https://images.unsplash.com/photo-1605000797499-95a51c5269ae?q=80&w=2070&auto=format&fit=crop')` }}
        />
        {/* Black fade overlay for deep dark mode */}
        <div className="fixed inset-0 z-[-1] bg-black/80" />
        
        <Header />
        <div className="flex-1 relative">
          {children}
        </div>
      </body>
    </html>
  );
}
