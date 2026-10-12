import Link from "next/link";
import { toCards } from "@/components/home/cards";
import { TournamentCard } from "@/components/home/TournamentCard";
import { listTournaments } from "@/server/data";
import { currentActor } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "My tournaments · Scheme" };

export default async function Mine() {
  const actor = await currentActor();
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
  const list = await listTournaments();
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
      <h1 className="page-title">My tournaments</h1>
      <p className="muted" style={{ marginTop: 6 }}>
        Everything you host or play in, as <b style={{ color: "var(--ink)" }}>{actor}</b>.
      </p>
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
