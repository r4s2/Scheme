"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: [string, string][] = [
  ["/", "Browse"],
  ["/host", "Host a tournament"],
  ["/mine", "My tournaments"],
  ["/teams", "Teams"],
  ["/leaderboards", "Leaderboards"],
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className="navlink" aria-current={(href === "/" ? path === "/" : path.startsWith(href)) ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
