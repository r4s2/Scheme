import Link from "next/link";
import { formatWhen } from "@/lib/format";
import { notificationsFor, people } from "@/server/data";
import { storeMode, storeProblem } from "@/server/store";
import { actingAsEnabled, currentActor } from "@/server/session";
import { ActingAs } from "./ActingAs";
import { LogoMark } from "./ui/Logo";
import { NavLinks } from "./NavLinks";
import { NotificationsMenu } from "./NotificationsMenu";

export async function Header() {
  const actor = await currentActor();
  const [notices, everyone] = await Promise.all([actor ? notificationsFor(actor) : [], actingAsEnabled() ? people() : []]);
  const offline = storeMode() === "offline";
  const problem = offline ? storeProblem() : null;
  const options = everyone.map((p) => ({
    handle: p.handle,
    label: p.host ? `${p.handle} · host` : p.teams[0] ? `${p.handle} · ${p.teams[0].name}${p.teams[0].captain ? " captain" : ""}` : p.handle,
  }));
  if (actor && !options.some((o) => o.handle === actor)) options.unshift({ handle: actor, label: actor });

  return (
    <header className="topbar">
      {offline && (
        <p className="offline-bar" role="status">
          {problem?.message ?? "Can't reach the database."} Showing demo data until it&rsquo;s back; Scheme reconnects on its own.
        </p>
      )}
      <div className="topbar-inner">
        <Link href="/" className="logo" aria-label="Scheme home">
          <LogoMark />
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
          <Link href={`/u/${actor}`} className="me" style={{ color: "inherit", textDecoration: "none" }}>
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
