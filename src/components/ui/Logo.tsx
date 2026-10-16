/** The Scheme mark: two blades between brackets. Drawn in the current text color. */
export const LOGO_PATHS = [
  "M434 32 211 129.5 153 260 165.5 277.5 447 49Z",
  "M26 444 249 346.5 307 216 294.5 198.5 13 427Z",
  "M53 160 10 186 24 307 24 189Z",
  "M423 320 466 294 452 173 452 291Z",
];

export function LogoMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 476 476" fill="currentColor" aria-hidden="true" {...props}>
      {LOGO_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
