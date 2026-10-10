export function SiteFooter() {
  return (
    <footer className="border-t bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-center gap-2 px-6 py-4 text-sm text-zinc-500">
        <span>Powered by</span>
        <a
          href="https://www.heycall-e.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center hover:opacity-70"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- third-party SVG, no benefit from next/image's raster pipeline */}
          <img src="/call-e-logo.svg" alt="CALL-E" className="h-5 w-auto" />
        </a>
      </div>
    </footer>
  );
}
