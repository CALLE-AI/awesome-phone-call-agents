import { renderToStaticMarkup } from "react-dom/server";

export interface MusterLogoProps {
  readonly size?: 16 | 20 | 24 | 32 | 48;
  readonly theme?: "light" | "dark" | "mono";
}

export function MusterLogo({ size = 24, theme = "light" }: MusterLogoProps) {
  const monochrome = theme !== "light";
  return (
    <span className={`muster-logo muster-logo--${theme}`} aria-label="Muster">
      <svg
        aria-hidden="true"
        className="muster-logo__mark"
        data-channel-count="3"
        data-source-node-count="3"
        data-terminal-node-count="1"
        height={size}
        viewBox="0 0 24 24"
        width={size}
      >
        <g
          fill="none"
          stroke={monochrome ? "currentColor" : "var(--brand-muster-deep)"}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.25"
        >
          <path d="M6 4h3l6 6h3" />
          <path d="M6 12h12" />
          <path d="M6 20h3l6-6h3" />
        </g>
        <g fill={monochrome ? "currentColor" : "var(--brand-instrument-teal)"}>
          <rect height="4" rx="1" width="4" x="2" y="2" />
          <rect height="4" rx="1" width="4" x="2" y="10" />
          <rect height="4" rx="1" width="4" x="2" y="18" />
        </g>
        <rect
          fill={monochrome ? "currentColor" : "var(--brand-muster-deep)"}
          height="4"
          rx="1"
          width="4"
          x="18"
          y="10"
        />
      </svg>
      <span className="muster-logo__wordmark">Muster</span>
    </span>
  );
}

export async function renderMusterLogoMarkup(options: MusterLogoProps = {}): Promise<string> {
  return renderToStaticMarkup(<MusterLogo {...options} />);
}
