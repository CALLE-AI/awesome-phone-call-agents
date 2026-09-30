import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function HarborBand({
  children,
  className,
  tone = "navy"
}: {
  children: ReactNode;
  className?: string;
  tone?: "navy" | "ink";
}) {
  return (
    <section
      className={cn(
        "harbor-full-bleed text-white",
        tone === "ink" ? "bg-harbor-ink" : "bg-harbor-navy",
        className
      )}
    >
      {children}
    </section>
  );
}
