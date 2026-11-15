import { useId } from "react";

// The agentcall mark: a black hole seen nearly edge on. The dome and the lower
// arc are the far side of the disk, bent over and under the shadow by
// lensing; the near side of the disk cuts across the front. The left side is
// brighter because that gas moves toward you. app/icon.svg is the same mark.
export function Logo({ size, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={className}>
      <defs>
        <linearGradient id={`${id}g`} x1="2" y1="0" x2="62" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff6e0" />
          <stop offset="0.5" stopColor="#f6c35b" />
          <stop offset="1" stopColor="#d06a22" />
        </linearGradient>
        <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path d="M0 35Q32 27.6 64 35Q32 42.4 0 35Z" fill="#000" />
        </mask>
      </defs>
      <g fill={`url(#${id}g)`}>
        <g mask={`url(#${id}m)`}>
          <path d="M6 35A26 24 0 0 1 58 35H47A15 15 0 0 0 17 35Z" />
          <path d="M13.5 35A18.5 17.5 0 0 0 50.5 35H47A15 15 0 0 1 17 35Z" />
        </g>
        <path d="M2 35Q32 30.8 62 35Q32 39.2 2 35Z" />
      </g>
    </svg>
  );
}
