import Link from "next/link";
import { formatWhen } from "@/lib/format";
import { notificationsFor, people } from "@/server/data";
import { storeMode } from "@/server/store";
import { actingAsEnabled, currentActor } from "@/server/session";
import { ActingAs } from "./ActingAs";
import { NavLinks } from "./NavLinks";
import { NotificationsMenu } from "./NotificationsMenu";

export async function Header() {
  const actor = await currentActor();
  const [notices, everyone] = await Promise.all([actor ? notificationsFor(actor) : [], actingAsEnabled() ? people() : []]);
  const offline = storeMode() === "offline";
  const options = everyone.map((p) => ({
    handle: p.handle,
    label: p.host ? `${p.handle} · host` : p.teams[0] ? `${p.handle} · ${p.teams[0].name}${p.teams[0].captain ? " captain" : ""}` : p.handle,
  }));
  if (actor && !options.some((o) => o.handle === actor)) options.unshift({ handle: actor, label: actor });

  return (
    <header className="topbar">
      {offline && (
        <p className="offline-bar" role="status">
          Can&rsquo;t reach the database from this network, so you&rsquo;re seeing demo data. Scheme reconnects on its own when it can.
        </p>
      )}
      <div className="topbar-inner">
        <Link href="/" className="logo" aria-label="Scheme home">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 5h5v5H3zM3 14h5v5H3z" stroke="currentColor" strokeWidth="2" />
            <path d="M8 7.5h3.5v9H8M11.5 12H16" stroke="currentColor" strokeWidth="2" />
            <path d="M16 9.5h5v5h-5z" fill="var(--accent)" stroke="var(--accent)" strokeWidth="2" />
          </svg>
          scheme
        </Link>
        <NavLinks />
        {actingAsEnabled() && <ActingAs actor={actor} people={options} />}
        {actor && (
          <NotificationsMenu
            notices={notices.slice(0, 20).map((n) => ({ id: n.id, body: n.body, link: n.link, when: formatWhen(n.createdAt), read: n.read }))}
          />
        )}
        {actor && (
          <Link href="/mine" className="me" style={{ color: "inherit", textDecoration: "none" }}>
            <span className="avatar" aria-hidden="true">
              {actor[0]?.toUpperCase()}
            </span>
            <span className="me-name">{actor}</span>
          </Link>
        )}
      </div>
    </header>
  );
}
