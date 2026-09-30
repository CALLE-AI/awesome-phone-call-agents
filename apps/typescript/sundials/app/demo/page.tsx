import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Shield, Sparkles, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HarborBand } from "./HarborBand";
import { PlanCtaLink } from "./PlanCtaLink";
import { CUSTOMERS, HUBS, PLANS, REVIEWS } from "./content";

export default function HarborHomePage() {
  return (
    <div>
      <HarborBand className="overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(15,118,110,0.35),transparent_42%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
          <div className="space-y-6">
            <p className="text-xs font-semibold tracking-[0.2em] text-teal-200 uppercase">Revenue operating system</p>
            <h1 className="max-w-xl text-5xl leading-[1.05] text-white sm:text-6xl">
              The CRM built for high-ticket teams.
            </h1>
            <p className="max-w-lg text-base leading-relaxed text-white/85">
              Harbor gives marketing, sales, and success one record of the account — so a $150k cycle does not live in
              five tools and a spreadsheet named “final_v7”.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href="/demo/contact" data-sc-cta="get_demo">
                  Get Demo
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
                asChild
              >
                <Link href="/demo/contact" data-sc-cta="talk_to_sales">
                  Talk to sales
                </Link>
              </Button>
              <Button size="lg" variant="link" className="px-0 text-teal-100" asChild>
                <Link href="/demo/pricing" data-sc-cta="learn_more">
                  See pricing
                  <ArrowRight />
                </Link>
              </Button>
            </div>
            <p className="text-xs text-white/75">Typical first-year contract $80k–$400k · SOC 2 Type II · EU or US residency</p>
          </div>
          <div className="relative">
            <div className="overflow-hidden rounded-2xl bg-white p-1.5 shadow-[0_28px_80px_rgba(0,0,0,0.4)]">
              <Image
                src="/harbor/harbor-hero.png"
                alt="Harbor revenue team collaborating in a waterfront office"
                width={1600}
                height={900}
                priority
                className="aspect-[16/10] w-full rounded-xl object-cover"
              />
            </div>
          </div>
        </div>
        <div className="relative border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-10 gap-y-3 px-6 py-5 text-xs tracking-wide text-white/80 uppercase">
            <span className="text-white/55">Trusted by</span>
            {CUSTOMERS.map((name) => (
              <span key={name} className="font-medium text-white/70">
                {name}
              </span>
            ))}
          </div>
        </div>
      </HarborBand>

      <section className="w-full bg-background">
        <div className="mx-auto max-w-6xl space-y-10 px-6 py-20">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Platform</p>
          <h2 className="text-4xl text-foreground">One customer record. Three hubs that stay in sync.</h2>
          <p className="text-muted-foreground">
            Harbor is the system of record for teams whose average deal is too large to lose in a handoff.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {HUBS.map((hub, index) => (
            <Card key={hub.title} className="bg-card">
              <CardHeader className="gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  {index === 0 ? <Sparkles className="size-4" /> : index === 1 ? <Workflow className="size-4" /> : <Shield className="size-4" />}
                </span>
                <CardTitle className="font-heading text-2xl">{hub.title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">{hub.body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
        </div>
      </section>

      <HarborBand tone="ink">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
          <div className="overflow-hidden rounded-2xl bg-white p-1.5 shadow-[0_28px_80px_rgba(0,0,0,0.35)]">
            <Image
              src="/harbor/harbor-product.png"
              alt="Harbor pipeline on a laptop in a waterfront office"
              width={1600}
              height={900}
              className="aspect-[16/10] w-full rounded-xl object-cover"
            />
          </div>
          <div className="space-y-5">
            <p className="text-xs font-semibold tracking-[0.2em] text-teal-200 uppercase">Built for long cycles</p>
            <h2 className="text-4xl text-white">See the buying committee, not just the last email.</h2>
            <ul className="space-y-3 text-sm text-white/75">
              {[
                "Multi-threaded deals with roles, influence, and next step on one timeline",
                "Sequences that pause when a champion goes quiet — not after you notice",
                "Forecast that finance can defend, with commit and upside that match the board pack"
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <Check className="mt-0.5 size-4 shrink-0 text-teal-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
              asChild
            >
              <Link href="/demo/pricing" data-sc-cta="learn_more">
                Compare plans
              </Link>
            </Button>
          </div>
        </div>
      </HarborBand>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 py-16 sm:grid-cols-3">
        {[
          { value: "4.8 / 5", label: "from 412 verified reviews" },
          { value: "31 days", label: "median time to first closed-won after cutover" },
          { value: "$180k", label: "average contract among Professional teams" }
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-border bg-card px-6 py-7">
            <p className="font-heading text-4xl">{stat.value}</p>
            <p className="mt-2 text-sm text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl space-y-8 px-6 pb-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-4xl">What revenue leaders say</h2>
            <p className="mt-2 text-muted-foreground">Unedited excerpts from teams that already run Harbor in production.</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/demo/reviews">All customer stories</Link>
          </Button>
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {REVIEWS.slice(0, 3).map((review) => (
            <Card key={review.name}>
              <CardHeader className="gap-4">
                <div className="flex items-center gap-3">
                  <Image
                    src={review.photo}
                    alt={review.name}
                    width={128}
                    height={128}
                    className="size-12 rounded-full object-cover"
                  />
                  <div>
                    <p className="text-sm font-medium">{review.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {review.title}, {review.company}
                    </p>
                  </div>
                </div>
                <blockquote className="text-sm leading-relaxed text-foreground">“{review.quote}”</blockquote>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-8 max-w-2xl">
          <h2 className="text-4xl">Straightforward seats. No module maze.</h2>
          <p className="mt-2 text-muted-foreground">
            Start with the hubs you need. Upgrade when security, residency, or a named CSM becomes the next conversation.
          </p>
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <Card key={plan.name} className={plan.featured ? "ring-2 ring-primary" : undefined}>
              <CardHeader>
                <CardTitle className="font-heading text-2xl">{plan.name}</CardTitle>
                <p className="font-heading text-4xl">
                  {plan.price}
                  {plan.price.startsWith("$") ? <span className="ml-1 text-base text-muted-foreground">/ seat</span> : null}
                </p>
                <CardDescription>{plan.blurb}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">
                  {plan.features.slice(0, 5).map((feature) => (
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
        </div>
      </section>

      <HarborBand>
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-16 md:flex-row md:items-center">
          <div className="max-w-xl space-y-2">
            <h2 className="text-4xl text-white">See Harbor with your own pipeline.</h2>
            <p className="text-white/85">
              A 30-minute working session — not a pitch deck. Bring a live deal and we will map it in the workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/demo/contact" data-sc-cta="get_demo">
                Get Demo
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
              asChild
            >
              <Link href="/demo/contact" data-sc-cta="talk_to_sales">
                Talk to sales
              </Link>
            </Button>
          </div>
        </div>
      </HarborBand>
    </div>
  );
}
