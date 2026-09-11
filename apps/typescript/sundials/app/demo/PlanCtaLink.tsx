import Link from "next/link";
import { PLANS, planContactHref } from "./content";

type Plan = (typeof PLANS)[number];

export function PlanCtaLink({ plan, className }: { plan: Plan; className?: string }) {
  return (
    <Link
      href={planContactHref(plan.plan)}
      className={className}
      data-sc-cta={plan.cta}
      data-sc-plan={plan.plan}
    >
      {plan.ctaLabel}
    </Link>
  );
}
