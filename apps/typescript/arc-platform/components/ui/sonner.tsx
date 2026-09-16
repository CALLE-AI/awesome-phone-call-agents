"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react"

/**
 * Arc Toast - BRANDING.md v1.1 sections 2 / 4 / 7.
 *
 * shadcn's version reads the theme from `next-themes` and defaults to
 * "system", which would hand a dark toast to anyone whose OS is in dark mode.
 * The brief says light is the base and no dark work ships this branch, so the
 * theme is pinned to "light" and the next-themes dependency is dropped. It
 * becomes a real toggle in the later dark pass.
 *
 * Copy rule (section 7): a button that says "Call" produces a toast that says
 * "Calling" - the action keeps its name through the flow.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />,
      }}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--text)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--surface)",
          "--success-text": "var(--text)",
          "--success-border": "var(--border)",
          "--error-bg": "var(--danger-bg)",
          "--error-text": "var(--danger)",
          "--error-border": "var(--danger)",
          "--border-radius": "var(--radius-control)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast font-sans text-small shadow-card",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
