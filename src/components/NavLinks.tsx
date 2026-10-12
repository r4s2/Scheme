"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: [string, string][] = [
  ["/", "Tournaments"],
  ["/mine", "My tournaments"],
  ["/teams", "Teams"],
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
