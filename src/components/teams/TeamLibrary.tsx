"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { GAMES, rankName, rankShortName, type GameId } from "@/engine";
import type { HoverTeam } from "@/components/bracket/hover";
import { HoverLayer } from "@/components/bracket/HoverLayer";
import { GameBadge, GameDot } from "@/components/ui/bits";
import { SearchIcon, TrophyIcon } from "@/components/ui/icons";
import { TeamOp } from "./TeamOp";

export interface TeamRow {
  id: string;
  name: string;
  game: GameId;
  captain: string;
  members: number;
  /** Average linked rank of active members, or null if nobody has linked the game. */
  avg: number | null;
  wins: number;
}

export interface PlayerRow {
  handle: string;
  accounts: { game: GameId; score: number; verified: boolean }[];
  wins: number;
  karma: number;
  recruitable: boolean;
  teams: string[];
}

type View = "teams" | "players";
type Sort = "wins" | "rank" | "name";
const PAGE = 40;

/**
 * The team and player library, which doubles as the leaderboard: search,
 * filter by game, sort by tournaments won (the leaderboard), rank or name,
 * and narrow players to those looking for a team. Captains can invite a
 * recruitable player straight from the list.
 */
export function TeamLibrary({
  teams,
  players,
  hover,
  myRosters,
  initialView = "teams",
}: {
  teams: TeamRow[];
  players: PlayerRow[];
  hover: Record<string, HoverTeam>;
  myRosters: { id: string; name: string; game: GameId; members: string[] }[];
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [q, setQ] = useState("");
  const [game, setGame] = useState<GameId | "all">("all");
  const [sort, setSort] = useState<Sort>("wins");
  const [recruitable, setRecruitable] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const needle = q.trim().toLowerCase();
  const teamList = useMemo(() => {
    const list = teams.filter((t) => (game === "all" || t.game === game) && (!needle || `${t.name} ${t.captain}`.toLowerCase().includes(needle)));
    return list.sort((a, b) => (sort === "wins" ? b.wins - a.wins : sort === "rank" ? (b.avg ?? -1) - (a.avg ?? -1) : 0) || a.name.localeCompare(b.name));
  }, [teams, game, needle, sort]);

  const scoreIn = (p: PlayerRow) => (game === "all" ? Math.max(-1, ...p.accounts.map((a) => a.score)) : (p.accounts.find((a) => a.game === game)?.score ?? -1));
  const playerList = useMemo(() => {
    const list = players.filter(
      (p) =>
        (game === "all" || p.accounts.some((a) => a.game === game)) &&
        (!recruitable || p.recruitable) &&
        (!needle || `${p.handle} ${p.teams.join(" ")}`.toLowerCase().includes(needle)),
    );
    return list.sort((a, b) => (sort === "wins" ? b.wins - a.wins : sort === "rank" ? scoreIn(b) - scoreIn(a) : 0) || a.handle.localeCompare(b.handle));
    // scoreIn depends only on game, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, game, needle, sort, recruitable]);

  /** Leaderboard position: shared on ties, only when sorted by wins. */
  const positions = <T,>(list: T[], wins: (x: T) => number) => {
    const out: number[] = [];
    list.forEach((x, i) => out.push(i > 0 && wins(list[i - 1]) === wins(x) ? out[i - 1] : i + 1));
    return out;
  };
  const list = view === "teams" ? teamList : playerList;
  const pos = sort === "wins" ? (view === "teams" ? positions(teamList, (t) => t.wins) : positions(playerList, (p) => p.wins)) : null;

  return (
    <section aria-label="Team and player library">
      <div className="lib-head">
        <h2>Library and leaderboard</h2>
        <span className="muted small" aria-live="polite">
          {list.length} {view === "teams" ? "teams" : "players"}
        </span>
      </div>
      <div className="card panel">
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="seg" role="tablist" aria-label="Show">
            {(["teams", "players"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => {
                  setView(v);
                  setShown(PAGE);
                }}
              >
                {v === "teams" ? "Teams" : "Players"}
              </button>
            ))}
          </div>
          <label className="searchbar" style={{ flex: 1, minWidth: 220, padding: "0 6px 0 12px" }}>
            <SearchIcon />
            <input type="search" placeholder={view === "teams" ? "Search teams or captains" : "Search players"} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" style={{ padding: "8px 4px", fontSize: 14 }} />
          </label>
          <select value={game} onChange={(e) => setGame(e.target.value as GameId | "all")} aria-label="Game">
            <option value="all">All games</option>
            {(Object.keys(GAMES) as GameId[]).map((g) => (
              <option key={g} value={g}>
                {GAMES[g].name}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="wins">Most tournaments won</option>
            <option value="rank">Highest rank</option>
            <option value="name">Name</option>
          </select>
          {view === "players" && (
            <label className="check small" style={{ whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={recruitable} onChange={(e) => setRecruitable(e.target.checked)} /> Recruitable only
            </label>
          )}
        </div>

        {list.length === 0 ? (
          <div className="empty">Nothing matches. Try another game or search.</div>
        ) : view === "teams" ? (
          <HoverLayer teams={hover}>
            <div className="tblwrap">
              <table className="tbl lb-table">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Team</th>
                    <th>Game</th>
                    <th>Captain</th>
                    <th className="num">Players</th>
                    <th>Avg rank</th>
                    <th className="num">Won</th>
                  </tr>
                </thead>
                <tbody>
                  {teamList.slice(0, shown).map((t, i) => (
                    <tr key={t.id}>
                      <td className="num mono muted">{pos ? pos[i] : i + 1}</td>
                      <td>
                        <span className="team static" data-team={t.id} tabIndex={0} style={{ padding: "2px 4px" }}>
                          <span className="tn">
                            <b>{t.name}</b>
                          </span>
                        </span>
                      </td>
                      <td>
                        <GameBadge game={t.game} />
                      </td>
                      <td>
                        <Link href={`/u/${t.captain}`} style={{ color: "inherit" }}>
                          {t.captain}
                        </Link>
                      </td>
                      <td className="num">{t.members}</td>
                      <td className="mono small">{t.avg === null ? "—" : rankName(t.game, t.avg)}</td>
                      <td className="num">
                        <span className="wins-cell">
                          <TrophyIcon />
                          {t.wins}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </HoverLayer>
        ) : (
          <div className="tblwrap">
            <table className="tbl lb-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Player</th>
                  <th>Ranks</th>
                  <th>Teams</th>
                  <th className="num">Karma</th>
                  <th className="num">Won</th>
                  {myRosters.length > 0 && <th>Recruit</th>}
                </tr>
              </thead>
              <tbody>
                {playerList.slice(0, shown).map((p, i) => {
                  const canJoin = myRosters.filter((r) => p.accounts.some((a) => a.game === r.game) && !r.members.includes(p.handle));
                  const accts = game === "all" ? p.accounts : p.accounts.filter((a) => a.game === game);
                  return (
                    <tr key={p.handle}>
                      <td className="num mono muted">{pos ? pos[i] : i + 1}</td>
                      <td>
                        <Link href={`/u/${p.handle}`} style={{ color: "inherit", fontWeight: 600 }}>
                          {p.handle}
                        </Link>
                        {p.recruitable && <span className="pill good" style={{ marginLeft: 6 }}>Recruitable</span>}
                      </td>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          {accts.map((a) => (
                            <span key={a.game} className="gbadge" title={`${GAMES[a.game].name}: ${rankName(a.game, a.score)}${a.verified ? ", verified" : ", self-reported"}`}>
                              <GameDot game={a.game} />
                              <span className="mono">{rankShortName(a.game, a.score)}</span>
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="small muted">{p.teams.join(", ") || "—"}</td>
                      <td className="num">{p.karma}</td>
                      <td className="num">
                        <span className="wins-cell">
                          <TrophyIcon />
                          {p.wins}
                        </span>
                      </td>
                      {myRosters.length > 0 && (
                        <td>
                          {canJoin.length > 0 && (
                            <TeamOp op="invite" className="row">
                              <input type="hidden" name="handle" value={p.handle} />
                              {canJoin.length === 1 ? (
                                <input type="hidden" name="rosterId" value={canJoin[0].id} />
                              ) : (
                                <select name="rosterId" aria-label={`Team to invite ${p.handle} to`} style={{ padding: "3px 6px", fontSize: 12.5, maxWidth: 140 }}>
                                  {canJoin.map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <button className="btn xs" title={`Invite ${p.handle} to ${canJoin.length === 1 ? canJoin[0].name : "one of your teams"}`}>
                                Invite{canJoin.length === 1 ? ` to ${canJoin[0].name}` : ""}
                              </button>
                            </TeamOp>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.length > shown && (
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button type="button" className="btn sm" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({list.length - shown} left)
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
