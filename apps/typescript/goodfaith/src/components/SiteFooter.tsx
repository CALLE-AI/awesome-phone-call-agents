// File: src/components/SiteFooter.tsx
export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-ink-800/80">
      <div className="mx-auto max-w-5xl px-6 py-8 text-xs leading-relaxed text-paper-500">
        <p className="max-w-2xl">
          Not medical or legal advice. GoodFaith captures no patient health information and never books an appointment.
          Every ranked price traces to a recorded transcript utterance, or it is not ranked.
        </p>
        <p className="mt-2">
          <a href="/proof" className="link">
            How the CALL-E integration works
          </a>
        </p>
      </div>
    </footer>
  );
}
