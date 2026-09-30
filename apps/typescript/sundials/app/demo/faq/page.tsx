import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HarborBand } from "../HarborBand";
import { HarborFaqList } from "../HarborFaqList";
import { FAQS } from "../content";

export default function FaqPage() {
  return (
    <div>
      <HarborBand>
        <div className="mx-auto max-w-6xl space-y-4 px-6 py-16">
            <p className="text-xs font-semibold tracking-[0.2em] text-teal-200 uppercase">FAQ</p>
          <h1 className="max-w-3xl text-5xl text-white">Answers a buying committee actually asks.</h1>
          <p className="max-w-2xl text-white/70">
            Procurement, security, and RevOps questions — the ones that stall a CRM cutover if you leave them for the
            last call.
          </p>
        </div>
      </HarborBand>
      <section className="mx-auto max-w-6xl space-y-4 px-6 py-16">
        <HarborFaqList items={FAQS} />
        <div className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <p className="text-sm text-muted-foreground">Still scoping an enterprise workspace?</p>
          <Button asChild>
            <Link href="/demo/contact" data-sc-cta="talk_to_sales">
              Talk to sales
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
