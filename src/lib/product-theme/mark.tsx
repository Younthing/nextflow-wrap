import type { ProductTheme } from "./index";

/**
 * Fluora mark: a cell outline with an off-centre glowing nucleus and a spectral emission arc.
 * Drawn in currentColor only so it reads as white-on-primary in the logo tile.
 */
function FluoraMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="2" opacity="0.55" />
      <circle cx="14" cy="17" r="6" fill="currentColor" opacity="0.18" />
      <circle cx="14" cy="17" r="3.4" fill="currentColor" />
      <path d="M20.5 6.8a10.5 10.5 0 0 1 4.7 6.1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="22.6" cy="11.4" r="1.3" fill="currentColor" />
    </svg>
  );
}

/** Logo-tile mark for the active product theme; themes without an SVG fall back to `shortName` text. */
export function ProductMark({ theme, className = "size-7" }: { theme: ProductTheme; className?: string }) {
  if (theme.id === "fluora") return <FluoraMark className={className} />;
  return <>{theme.shortName}</>;
}
