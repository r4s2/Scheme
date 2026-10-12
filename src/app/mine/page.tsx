import Link from "next/link";
import { toCards } from "@/components/home/cards";
import { TournamentCard } from "@/components/home/TournamentCard";
import { Wizard } from "@/components/host/Wizard";
import { listTournaments } from "@/server/data";
import { getStore } from "@/server/store";
import { currentActor } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "My tournaments · Scheme" };

export default async function Mine({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const [actor, sp] = await Promise.all([currentActor(), searchParams]);
  if (!actor) {
    return (
      <main>
        <h1 className="page-title">My tournaments</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Sign in to see the tournaments you host and play in.
        </p>
      </main>
    );
  }
  const hostingNew = sp.new === "1";
  const [list, [me]] = await Promise.all([listTournaments(), hostingNew ? getStore().profiles([actor]) : Promise.resolve([])]);
  const now = new Date();
  const active = (s: string) => s !== "complete" && s !== "cancelled";
  const hosting = list.filter((t) => t.host === actor);
  const playing = list.filter((t) => t.host !== actor && t.players.includes(actor));
  const sections: [string, typeof list, string][] = [
    ["Hosting", hosting.filter((t) => active(t.status)), "You aren't hosting anything right now."],
    ["Playing", playing.filter((t) => active(t.status)), "You aren't signed up for anything right now."],
    ["Past events", [...hosting, ...playing].filter((t) => !active(t.status)).sort((a, b) => b.startsAt.localeCompare(a.startsAt)), "Nothing yet."],
  ];
  return (
    <main>
      <div className="section-h" style={{ marginTop: 0 }}>
        <h1 className="page-title">My tournaments</h1>
        {hostingNew ? (
          <Link href="/mine" className="btn">
            Cancel
          </Link>
        ) : (
          <Link href="/mine?new=1" className="btn primary">
            Host a tournament
          </Link>
        )}
      </div>
      <p className="muted" style={{ marginTop: -4 }}>
        Everything you host or play in, as <b style={{ color: "var(--ink)" }}>{actor}</b>.
      </p>
      {hostingNew && (
        <section style={{ marginTop: 18 }} aria-label="Host a tournament">
          <Wizard hostKarma={me?.hostKarma ?? 70} now={new Date().toISOString()} />
        </section>
      )}
      {sections.map(([title, items, empty]) => (
        <section key={title}>
          <div className="section-h">
            <h2>{title}</h2>
            <span className="muted small">{items.length}</span>
          </div>
          {items.length ? (
            <div className="lib-grid">
              {toCards(items, now).map((c) => (
                <TournamentCard key={c.id} c={c} />
              ))}
            </div>
          ) : (
            <div className="empty">
              {empty} <Link href="/">Browse tournaments</Link>
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
