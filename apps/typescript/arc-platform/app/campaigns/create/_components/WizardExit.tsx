"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Way out of the wizard. Without this a user is trapped: the wizard shell has
 * no nav and no sign-out.
 *
 * Goes to /campaigns. Every authenticated route now resolves the brand through
 * getOrCreateBrand, so there is no gate to bounce off - but /campaigns remains
 * the right destination: it is where a part-finished campaign belongs.
 *
 * The confirm says progress is kept because it genuinely is - WizardProvider
 * writes the whole state to localStorage on every change and restores it on
 * mount, with a 24-hour expiry. Wording it as "you'll lose your progress"
 * would be untrue.
 */
export function WizardExit({ firstRun = false }: { firstRun?: boolean }) {
  const router = useRouter();

  /**
   * First run reads as skipping, not exiting. Someone who has never created a
   * campaign cannot go "back to campaigns" - they have never been there. It
   * also promises no destination they would recognise, and "for now" says the
   * wizard will still be there later, which is true: the brief persists for 24
   * hours. Skipping lands on /dashboard, which renders the empty state.
   */
  if (firstRun) {
    return (
      <Button variant="ghost" size="sm" className="-ml-3" onClick={() => router.push("/dashboard")}>
        Skip for now
      </Button>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        {/* -ml-3 cancels the button's own left padding so the label sits flush
            with the header's left edge rather than indented inside it. */}
        <Button variant="ghost" size="sm" className="-ml-3">
          <ArrowLeft aria-hidden strokeWidth={1.75} />
          Back to campaigns
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Back to campaigns?</DialogTitle>
          <DialogDescription>
            Your brief is saved. You can pick this campaign up where you left off
            for the next 24 hours.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Stay here</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={() => router.push("/campaigns")}>Back to campaigns</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
