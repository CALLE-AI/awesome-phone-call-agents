"use client"

import { SignUp } from "@clerk/nextjs"

import { AuthShell } from "@/components/auth/AuthShell"
import { arcClerkAppearance } from "@/components/auth/appearance"

export default function SignUpPage() {
  return (
    <AuthShell
      footerPrompt="Already have an account?"
      footerLinkLabel="Sign in"
      footerHref="/sign-in"
    >
      <SignUp
        forceRedirectUrl="/campaigns/create?first=1"
        signInUrl="/sign-in"
        appearance={arcClerkAppearance}
      />
    </AuthShell>
  )
}
