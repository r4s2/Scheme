// Icons from the prototype. Decorative: wrap with text or an aria-label.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

export const LockIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.6"/></svg>
);

export const TrophyIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><path d="M5 2h6v4a3 3 0 0 1-6 0V2Z" stroke="currentColor" strokeWidth="1.5"/><path d="M5 3.5H2.5A2.5 2.5 0 0 0 5 7M11 3.5h2.5A2.5 2.5 0 0 1 11 7M8 9v3M5.5 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
);

export const CheckIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/><path d="m5.2 8.2 1.9 1.9 3.8-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
);

export const WarnIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><path d="M8 2.2 14.3 13.5H1.7L8 2.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M8 6.5v3.2M8 11.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
);

export const BlockIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/><path d="m5.5 5.5 5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
);

export const InfoIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 7.2v4M8 4.8v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
);

export const SearchIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8"/><path d="m13.5 13.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
);

export const ShuffleIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><path d="M2 4h2.5c3.5 0 3.5 8 7 8H14M2 12h2.5c1.4 0 2.2-1.3 2.9-3M11.5 4H14M12 2l2 2-2 2M12 10l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
);

export const SeedIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><path d="M3 13V9M8 13V5M13 13V2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
);

export const TransformIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><path d="M2 4h4v3H2zM10 9h4v3h-4zM6 5.5h2.5V10.5H10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
);

export const MegaphoneIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><path d="M2.5 6.5v3h2l5 3v-9l-5 3h-2ZM12 6a2.5 2.5 0 0 1 0 4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg>
);

export const SparkIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8l5.1-1.4L8 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
);

export const DownIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
);

export const BellIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 20 20" fill="none"><path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5.5 1.5 5.5h-13S5 12 5 8ZM8 16.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"/></svg>
);

export const FlagIcon = (p: P) => (
  <svg aria-hidden="true" focusable="false" {...p} viewBox="0 0 16 16" fill="none"><path d="M3.5 14V2.5M3.5 3h8l-1.5 3 1.5 3h-8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg>
);
