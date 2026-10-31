/* The Shorts mark: a blue rounded square with an S. */
export function BrandLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="block shrink-0" role="img" aria-label="Shorts">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <text x="16" y="22.5" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontWeight="800" fontSize="18" fill="#fff">S</text>
    </svg>
  );
}
