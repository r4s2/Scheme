import { GAMES, type GameId } from "@/engine";
import { Boards } from "@/components/leaderboard/Boards";
import { leaderboards } from "@/server/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leaderboards · Scheme" };

export default async function LeaderboardsPage() {
  const boards = await leaderboards();
  const missing = (Object.keys(GAMES) as GameId[]).filter((g) => !boards.some((b) => b.key === g)).map((g) => GAMES[g].name);
  return (
    <main>
      <h1 className="page-title" style={{ marginBottom: 6 }}>
        Leaderboards
      </h1>
      <p className="muted" style={{ marginBottom: 18, maxWidth: "64ch" }}>
        Ranked by tournaments won on Scheme. A game gets its own board once it has a completed tournament. These are community standings, not official game rankings.
      </p>
      <Boards boards={boards} missing={missing} />
    </main>
  );
}
