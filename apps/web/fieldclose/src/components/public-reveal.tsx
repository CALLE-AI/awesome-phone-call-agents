"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";

type PublicRevealProps = Readonly<{
  children: ReactNode;
  className?: string;
  delay?: number;
}>;

type PublicRevealStyle = CSSProperties & {
  "--public-reveal-delay"?: string;
};

export function PublicReveal({
  children,
  className = "",
  delay = 0,
}: PublicRevealProps) {
  const revealRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = revealRef.current;

    if (!element) {
      return;
    }

    element.dataset.revealReady = "true";

    if (!("IntersectionObserver" in window)) {
      element.dataset.revealed = "true";
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          element.dataset.revealed = "true";
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10%", threshold: 0.12 },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const style: PublicRevealStyle = {
    "--public-reveal-delay": `${delay}ms`,
  };

  return (
    <div className={`public-reveal ${className}`.trim()} ref={revealRef} style={style}>
      {children}
    </div>
  );
}
