import Link from "next/link";
import AppShell from "@/components/app-shell";
import VaccineChat from "@/components/vaccine-chat";

export default function Dashboard() {
    return (
        <AppShell>
            <div className="mb-8">
                <h1 className="font-display text-2xl text-ink mb-2">
                    Welcome to VaxConnect 👋
                </h1>

                <p className="text-sm text-ink/60">
                    Your vaccination information and coordination hub.
                </p>
            </div>

            {/* Four Main Sections */}
            <div className="grid grid-cols-2 gap-4 max-w-2xl">
                <Card
                    href="/child-vaccine/info"
                    icon="👶"
                    title="Child Vaccination"
                    body="Check age-appropriate vaccines for your child."
                    cta="Check Vaccines"
                />

                <Card
                    href="/travel-vaccine/country"
                    icon="✈️"
                    title="Travel Vaccination"
                    body="Check vaccination needs for your destination."
                    cta="Check Vaccines"
                />

                <Card
                    href="/vaccine-assistant"
                    icon="💉"
                    title="Vaccine Hub"
                    body="Explore vaccines, diseases, doses, and boosters."
                    cta="Check Vaccines"
                />

                <Card
                    href="/history"
                    icon="📖"
                    title="Booking History"
                    body="View provider calls and appointment activity."
                    cta="View History"
                />
            </div>

            {/* AI Assistant */}
            <div className="mt-10 max-w-3xl">
                <div className="border border-teal/30 bg-teal/5 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-8 h-8 rounded-full bg-teal/10 flex items-center justify-center text-base">
                            🤖
                        </div>

                        <div>
                            <h2 className="font-display text-xl text-ink">
                                Ask VaxConnect AI
                            </h2>

                            <p className="text-sm text-ink/60 mt-1">
                                Get personalized answers about vaccines,
                                schedules, travel, doses, and more.
                            </p>
                        </div>
                    </div>

                    <VaccineChat />
                </div>
            </div>
        </AppShell>
    );
}

function Card({
                  href,
                  icon,
                  title,
                  body,
                  cta,
              }: {
    href: string;
    icon: string;
    title: string;
    body: string;
    cta: string;
}) {
    return (
        <Link
            href={href}
            className="group border border-line bg-white/40 rounded-xl p-5 min-h-[170px] flex flex-col hover:border-teal hover:bg-white/60 transition-all"
        >
            <div className="text-xl mb-3">
                {icon}
            </div>

            <h2 className="font-display text-lg text-ink mb-2">
                {title}
            </h2>

            <p className="text-sm text-ink/60 leading-relaxed">
                {body}
            </p>

            <span className="text-sm font-medium text-teal mt-auto pt-4 group-hover:underline">
                {cta} →
            </span>
        </Link>
    );
}