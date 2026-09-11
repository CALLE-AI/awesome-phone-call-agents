"use client"

import { SignIn } from "@clerk/nextjs"

import { AuthShell } from "@/components/auth/AuthShell"
import { arcClerkAppearance } from "@/components/auth/appearance"

export default function SignInPage() {
  return (
    <AuthShell
      footerPrompt="New to Arc?"
      footerLinkLabel="Create an account"
      footerHref="/sign-up"
    >
      <SignIn
        forceRedirectUrl="/dashboard"
        signUpUrl="/sign-up"
        appearance={arcClerkAppearance}
      />
    </AuthShell>
  )
}
