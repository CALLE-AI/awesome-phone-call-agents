import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HarborBand } from "../HarborBand";
import { HarborFaqList } from "../HarborFaqList";
import { PlanCtaLink } from "../PlanCtaLink";
import { COMPARISON, FAQS, PLANS } from "../content";

export default function PricingPage() {
  return (
    <div>
      <HarborBand>
        <div className="mx-auto max-w-6xl space-y-4 px-6 py-16">
            <p className="text-xs font-semibold tracking-[0.2em] text-teal-200 uppercase">Pricing</p>
          <h1 className="max-w-3xl text-5xl text-white">Seats that match how a revenue team actually buys.</h1>
          <p className="max-w-2xl text-white/70">
            No per-hub add-ons. Professional is the plan most mid-market teams start on. Enterprise is a security and
            residency conversation, not a feature unlock.
          </p>
        </div>
      </HarborBand>

      <section className="mx-auto grid max-w-6xl gap-5 px-6 py-16 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <Card key={plan.name} className={plan.featured ? "ring-2 ring-primary" : undefined}>
            <CardHeader className="gap-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="font-heading text-2xl">{plan.name}</CardTitle>
                {plan.featured ? <Badge>Most chosen</Badge> : null}
              </div>
              <p className="font-heading text-5xl">
                {plan.price}
                {plan.price.startsWith("$") ? (
                  <span className="ml-1 text-base text-muted-foreground">{plan.cadence}</span>
                ) : (
                  <span className="ml-2 text-base text-muted-foreground">{plan.cadence}</span>
                )}
              </p>
              <CardDescription>{plan.billed}</CardDescription>
              <p className="text-sm text-foreground">{plan.blurb}</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <ul className="space-y-2.5 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button className="w-full" variant={plan.cta === "talk_to_sales" ? "outline" : "default"} asChild>
                <PlanCtaLink plan={plan} />
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mx-auto max-w-6xl space-y-6 px-6 pb-16">
        <div>
          <h2 className="text-3xl">Compare plans</h2>
          <p className="mt-2 text-muted-foreground">What a procurement team usually asks before the security pack.</p>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[36%]">Capability</TableHead>
                  <TableHead>Starter</TableHead>
                  <TableHead>Professional</TableHead>
                  <TableHead>Enterprise</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {COMPARISON.map((row) => (
                  <TableRow key={row.feature}>
                    <TableCell className="font-medium">{row.feature}</TableCell>
                    <TableCell>{row.starter}</TableCell>
                    <TableCell>{row.professional}</TableCell>
                    <TableCell>{row.enterprise}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="mx-auto max-w-6xl space-y-6 px-6 pb-20">
        <h2 className="text-3xl">Buying questions</h2>
        <HarborFaqList items={FAQS.slice(0, 4)} compact />
      </section>
    </div>
  );
}
