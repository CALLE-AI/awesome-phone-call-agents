"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function useAnimatedNumber(target: number, durationMs = 800) {
  const hydrated = useHydrated();
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const currentRef = useRef(0);
  const targetRef = useRef(target);
  const introRef = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    targetRef.current = target;
    const from = introRef.current ? fromRef.current : 0;
    introRef.current = true;

    if (prefersReducedMotion() || from === target) {
      fromRef.current = target;
      currentRef.current = target;
      setDisplay(target);
      return;
    }

    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / durationMs);
      const next = from + (target - from) * easeOutCubic(t);
      currentRef.current = next;
      setDisplay(next);
      if (t < 1 && targetRef.current === target) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = targetRef.current;
        currentRef.current = targetRef.current;
        setDisplay(targetRef.current);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      fromRef.current = currentRef.current;
    };
  }, [hydrated, target, durationMs]);

  return hydrated ? display : target;
}

function formatNumber(value: number, decimals: number) {
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}

export function AnimatedNumber({
  value,
  decimals = 0,
  className
}: {
  value: number;
  decimals?: number;
  className?: string;
}) {
  const display = useAnimatedNumber(value);
  return <span className={className}>{formatNumber(display, decimals)}</span>;
}
