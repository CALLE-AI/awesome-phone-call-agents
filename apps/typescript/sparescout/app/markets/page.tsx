import type { Metadata } from "next";
import { PublicPage } from "../components/site-chrome";
import { SUPPORTED_MARKETS } from "../../lib/markets";

export const metadata: Metadata = {
  title: "SpareScout Supported Markets",
  description: "The 17 recipient regions, spoken languages, and currencies currently available in SpareScout.",
};

export default function MarketsPage() {
  return (
    <PublicPage
      eyebrow="Supported markets"
      title="Global-ready means precise about where calling works."
      intro="SpareScout currently matches CALL-E’s supported recipient regions and only offers spoken languages available for each market."
    >
      <section className="market-grid" aria-label="Supported CALL-E markets">
        {SUPPORTED_MARKETS.map((market) => (
          <article key={market.countryCode}>
            <span className="market-code">{market.countryCode}</span>
            <h2>{market.countryName}</h2>
            <p>{market.locales.map((locale) => locale.label).join(" · ")}</p>
            <small>{market.currency} quotes · {market.defaultLocation} demo</small>
          </article>
        ))}
      </section>
      <p className="source-note">Availability follows the CALL-E supported-regions list and should be rechecked before a live deployment in a new market.</p>
    </PublicPage>
  );
}
