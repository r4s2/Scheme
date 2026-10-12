import { GAMES, type GameId } from "@/engine";
import { toCards } from "@/components/home/cards";
import { Library } from "@/components/home/Library";
import { Ticker } from "@/components/leaderboard/Ticker";
import { leaderboards, listTournaments } from "@/server/data";
import { getStore, storeMode } from "@/server/store";
import { currentActor } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await currentActor();
  const [list, boards, me] = await Promise.all([listTournaments(), leaderboards(), actor ? getStore().profiles([actor]) : Promise.resolve([])]);
  const myRanks = Object.fromEntries((me[0]?.accounts ?? []).map((a) => [a.game, a.rankScore])) as Partial<Record<GameId, number>>;
  const now = new Date();
  const mode = storeMode();
  const open = list.filter((t) => t.status === "registration" || t.status === "checkin" || t.status === "live");
  const order = (st: string) => (st === "live" ? 0 : st === "checkin" ? 1 : 2);
  open.sort((a, b) => order(a.status) - order(b.status) || a.startsAt.localeCompare(b.startsAt));
  const cards = toCards(open, now);
  const missing = (Object.keys(GAMES) as GameId[]).filter((g) => !boards.some((b) => b.key === g)).map((g) => GAMES[g].name);

  return (
    <main>
      {list.length === 0 && mode === "database" && (
        <div className="banner info">
          <div className="btext">
            <b>The database is connected but empty.</b>
            To load the sample tournaments, run <code>npm run db:setup</code> in the project folder, then reload this page.
          </div>
        </div>
      )}
      <Library
        cards={cards}
        myRanks={myRanks}
        hero={
          <>
            <h1>Find a bracket for tonight.</h1>
            <p className="sub">
              Every player here has a verified rank, every host has a karma score, and every entry fee is handled by Scheme. Join with your team or sign up solo and get
              placed on a balanced one.
            </p>
          </>
        }
        aside={<Ticker boards={boards} missing={missing} />}
      />
      <p className="tiny muted" style={{ marginTop: 24 }}>
        {mode === "database" ? "Live data from the database." : "Demo data, kept in memory until the server restarts. Use “Acting as” at the top to be the host or any player."}
      </p>
    </main>
  );
}
