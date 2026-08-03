/**
 * The system mark (JOS-01A).
 *
 * Code-native SVG rather than an icon package: one mark, drawn once, with no dependency and
 * no runtime font or CDN fetch. The glyph is a bracketed core — a control plane observing
 * something it does not own.
 */
export function BrandMark({ size = 26 }: { readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="jos-mark" x1="4" y1="3" x2="28" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-accent-bright)" />
          <stop offset="0.55" stopColor="var(--color-accent)" />
          <stop offset="1" stopColor="var(--color-violet)" />
        </linearGradient>
      </defs>
      <rect
        x="1.25"
        y="1.25"
        width="29.5"
        height="29.5"
        rx="8"
        stroke="var(--color-line-strong)"
        strokeWidth="1.5"
      />
      <path
        d="M11 8.5H9.5A2.5 2.5 0 0 0 7 11v10a2.5 2.5 0 0 0 2.5 2.5H11"
        stroke="url(#jos-mark)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M21 8.5h1.5A2.5 2.5 0 0 1 25 11v10a2.5 2.5 0 0 1-2.5 2.5H21"
        stroke="url(#jos-mark)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="3.25" fill="url(#jos-mark)" />
      <circle cx="16" cy="16" r="6.25" stroke="url(#jos-mark)" strokeWidth="1.25" opacity="0.45" />
    </svg>
  );
}

export function BrandLockup() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <div className="leading-none">
        <p className="text-[13px] font-semibold tracking-[0.14em] text-[var(--color-ink)]">
          JARVIS OS
        </p>
        <p className="mt-1 text-[10px] tracking-[0.1em] text-[var(--color-ink-faint)] uppercase">
          Control Plane
        </p>
      </div>
    </div>
  );
}
