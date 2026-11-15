// A tiny CSS echo of the hero black hole: a flat spinning disk, the lensed
// ring around the shadow and a pure-black core. Transform-only animation, so
// it stays on the compositor even on low-end phones.
export function Singularity({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={`sg ${className}`} style={{ width: size, height: size }}>
      <span className="sg-glow" />
      <span className="sg-disk">
        <span className="sg-disk-spin" />
      </span>
      <span className="sg-ring" />
      <span className="sg-core" />
    </span>
  );
}
