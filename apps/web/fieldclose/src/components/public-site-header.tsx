import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { projectConfig } from "@/config/project";

type PublicSiteHeaderProps = {
  actionHref: string;
  actionLabel: string;
};

export function PublicSiteHeader({
  actionHref,
  actionLabel,
}: PublicSiteHeaderProps) {
  return (
    <header className="public-site-header">
      <Link aria-label="FieldClose home" className="brand-lockup" href="/">
        <BrandMark />
        <span className="brand-copy">
          <strong>{projectConfig.name}</strong>
          <span>Closeout operations</span>
        </span>
      </Link>
      <nav aria-label="Public navigation">
        <Link className="public-guide-link" href={actionHref}>
          <span aria-hidden="true">↗</span>
          {actionLabel}
        </Link>
      </nav>
    </header>
  );
}
