import Image from "next/image";
import Link from "next/link";
import logo from "@/public/logo.png";

export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center">
          <Image src={logo} alt="MinuteOne" className="h-7 w-auto" priority />
        </Link>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Lead form
          </Link>
          <Link href="/review" className="hover:text-foreground">
            Review console
          </Link>
          <Link href="/setup" className="hover:text-foreground">
            Configure
          </Link>
        </nav>
      </div>
    </header>
  );
}
