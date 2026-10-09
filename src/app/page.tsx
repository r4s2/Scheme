import Link from "next/link";
import { GAMES } from "@/engine";
import ui from "@/components/ui.module.css";
import { getStore, storeMode } from "@/server/store";
import { currentActor } from "@/server/session";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  draft: "Draft",
  registration: "Registration open",
  checkin: "Check-in open",
  live: "Live",
  complete: "Closed",
  cancelled: "Cancelled",
};

export default async function Home() {
  const [list, actor] = await Promise.all([getStore().list(), currentActor()]);
  return (
    <main className={ui.page}>
      <h1 className={ui.title}>Tournaments</h1>
      <p className={ui.lead} style={{ marginTop: 8 }}>
        {storeMode() === "database"
          ? "Live data from the database."
          : "Demo data, kept in memory until the server restarts. Use “Acting as” at the top to be the host or any player."}
      </p>
      <div className={ui.grid2}>
        {list.map((t) => (
          <Link key={t.id} href={`/t/${t.id}`} className={ui.card} style={{ textDecoration: "none", color: "inherit" }}>
            <div className={ui.row} style={{ justifyContent: "space-between" }}>
              <span className={ui.pill}>{GAMES[t.game].name}</span>
              <span className={`${ui.pill} ${t.status === "live" ? ui.pillBad : t.status === "complete" ? ui.pillGood : ui.pillInfo}`}>{STATUS[t.status]}</span>
            </div>
            <h3 style={{ marginTop: 10, fontSize: 18 }}>{t.name}</h3>
            <p className={`${ui.small} ${ui.muted}`}>
              Hosted by {t.host}
              {actor === t.host ? " (you)" : ""}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
