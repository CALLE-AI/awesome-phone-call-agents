"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { SignInScreen } from "@/components/sign-in-screen";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function AuthDrawer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const authView = searchParams.get("auth");
  const open = authView === "signin" || authView === "signup";
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const closeDrawer = useCallback(() => {
    router.replace("/");
  }, [router]);

  useEffect(() => {
    if (!open) {
      return;
    }

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const firstFocusable =
        panelRef.current?.querySelector<HTMLElement>(focusableSelector);
      firstFocusable?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDrawer();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }

      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [closeDrawer, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="auth-drawer-backdrop"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeDrawer();
        }
      }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          closeDrawer();
        }
      }}
    >
      <section
        aria-labelledby="account-access-title"
        aria-modal="true"
        className="auth-drawer"
        ref={panelRef}
        role="dialog"
      >
        <SignInScreen
          initialView={authView === "signup" ? "sign-up" : "sign-in"}
          key={authView}
          returnTo={returnTo}
        />
      </section>
    </div>
  );
}

function safeReturnTo(value: string | null) {
  if (!value?.startsWith("/workspace") || value.startsWith("//")) {
    return "/workspace";
  }

  return value;
}
