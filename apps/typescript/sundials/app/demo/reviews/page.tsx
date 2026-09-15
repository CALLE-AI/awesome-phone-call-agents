import Image from "next/image";
import Link from "next/link";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { HarborBand } from "../HarborBand";
import { REVIEWS } from "../content";

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, index) => (
        <Star
          key={index}
          className={`size-4 ${index < rating ? "fill-primary text-primary" : "text-border"}`}
        />
      ))}
    </div>
  );
}

export default function ReviewsPage() {
  return (
    <div>
      <HarborBand>
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div className="space-y-4">
            <p className="text-xs font-semibold tracking-[0.2em] text-teal-200 uppercase">Customers</p>
            <h1 className="text-5xl text-white">Revenue teams that already run Harbor.</h1>
            <p className="max-w-xl text-white/70">
              Named operators at logistics, cloud, health, and capital teams — the profiles a CRO actually asks for
              before a cutover.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-5">
            <p className="font-heading text-5xl">4.8</p>
            <Stars rating={5} />
            <p className="mt-2 text-sm text-white/60">412 verified reviews · last 12 months</p>
          </div>
        </div>
      </HarborBand>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 py-16 lg:grid-cols-2">
        {REVIEWS.map((review) => (
          <Card key={review.name} className="overflow-hidden">
            <CardHeader className="flex flex-row items-start gap-4">
              <Image
                src={review.photo}
                alt={review.name}
                width={160}
                height={160}
                className="size-16 rounded-full object-cover"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{review.name}</p>
                  <Stars rating={review.rating} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {review.title} · {review.company}
                </p>
                <p className="text-xs text-muted-foreground">{review.date}</p>
              </div>
            </CardHeader>
            <CardContent>
              <blockquote className="text-base leading-relaxed">“{review.quote}”</blockquote>
            </CardContent>
          </Card>
        ))}
      </section>

      <HarborBand>
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-16 md:flex-row md:items-center">
          <div className="max-w-xl">
            <h2 className="text-4xl text-white">Ask a customer reference from your industry.</h2>
            <p className="mt-2 text-white/65">Enterprise trials include two live references in logistics, health, or cloud.</p>
          </div>
          <Button size="lg" asChild>
            <Link href="/demo/contact" data-sc-cta="talk_to_sales">
              Talk to sales
            </Link>
          </Button>
        </div>
      </HarborBand>
    </div>
  );
}
