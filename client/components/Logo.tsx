import { useId } from 'react';

/**
 * The aye-aye mark in one color (currentColor): peeking over a database stack, hand on the lid,
 * bushy tail on the right. Eyes are cut out so the background shows through.
 * Geometry is shared with assets/icon.svg (the app icon, white on green); keep them in sync.
 */
export function Logo({ className }: { className?: string }) {
  // Unique mask id per instance (useId can contain characters that aren't valid in url(#…)).
  const maskId = `logo-cut-${useId().replace(/[^\w-]/g, '')}`;

  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Aye-aye">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <circle cx="26.5" cy="24.4" r="4.4" fill="#000" />
          <circle cx="37.5" cy="24.4" r="4.4" fill="#000" />
          <circle cx="26.9" cy="24.9" r="2" fill="#fff" />
          <circle cx="37.1" cy="24.9" r="2" fill="#fff" />
          <ellipse cx="32" cy="40" rx="18.4" ry="6.8" fill="#000" />
          <rect x="13.6" y="40" width="36.8" height="24" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <g fill="currentColor" transform="translate(32 26) scale(0.78) translate(-32 -31)">
          <ellipse cx="16.5" cy="15" rx="9.5" ry="13.5" transform="rotate(-30 16.5 15)" />
          <ellipse cx="47.5" cy="15" rx="9.5" ry="13.5" transform="rotate(30 47.5 15)" />
          <ellipse cx="32" cy="31" rx="16" ry="13.5" />
          <ellipse cx="32" cy="40.5" rx="7" ry="5" />
        </g>
      </g>
      <path
        d="M48.6 52 C54.5 51.5 59.5 47 60 39 C60.3 34 58.8 30 56 28.4 C56.8 31.2 56.8 34.5 55.8 38 C54.6 42.4 51.8 45.6 48.6 46.6 Z"
        fill="currentColor"
      />
      <path
        d="M15 40v13c0 3 7.6 5.4 17 5.4s17-2.4 17-5.4V40M15 46.6c0 3 7.6 5.4 17 5.4s17-2.4 17-5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
      />
      <ellipse cx="32" cy="40" rx="17" ry="5.4" fill="none" stroke="currentColor" strokeWidth="2.6" />
      {/* Two paws gripping the lid's back edge under the chin: knuckles + three short fingers each. */}
      <ellipse cx="22.6" cy="34.4" rx="3.3" ry="2.1" fill="currentColor" />
      <path
        d="M20.9 34.6 L20.9 38.6 M22.6 34.6 L22.6 39 M24.3 34.6 L24.3 38.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <ellipse cx="41.4" cy="34.4" rx="3.3" ry="2.1" fill="currentColor" />
      <path
        d="M39.7 34.6 L39.7 38.6 M41.4 34.6 L41.4 39 M43.1 34.6 L43.1 38.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
