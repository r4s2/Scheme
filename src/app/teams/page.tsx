import Link from "next/link";
import { GAMES, rankName, rankShortName, type GameId } from "@/engine";
import { hoverTeam, type HoverTeam } from "@/components/bracket/hover";
import { TeamLibrary, type PlayerRow, type TeamRow } from "@/components/teams/TeamLibrary";
import { TeamOp } from "@/components/teams/TeamOp";
import { PlayerPicker } from "@/components/PlayerPicker";
import { GameBadge } from "@/components/ui/bits";
import { getStore } from "@/server/store";
import { currentActor } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teams · Scheme" };

export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [actor, sp] = await Promise.all([currentActor(), searchParams]);
  if (!actor) {
    return (
      <main>
        <h1 className="page-title">Teams</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Sign in to manage your teams.
        </p>
      </main>
    );
  }
  const store = getStore();
  const [rosters, wins, everyone, directory] = await Promise.all([store.rosters(actor), store.wins(), store.allRosters(), store.directory()]);
  const profiles = new Map(directory.map((p) => [p.handle.toLowerCase(), p]));
  const rankOf = (h: string, g: GameId) => profiles.get(h.toLowerCase())?.accounts.find((a) => a.game === g)?.rankScore;
  const winsOf = (game: GameId, name: string) => wins.filter((w) => w.game === game && w.team.toLowerCase() === name.toLowerCase()).length;
  const library: TeamRow[] = everyone.map((r) => {
    const active = r.members.filter((m) => m.status === "active");
    const ranks = active.flatMap((m) => rankOf(m.handle, r.game) ?? []);
    return { id: r.id, name: r.name, game: r.game, captain: r.captain, members: active.length, avg: ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null, wins: winsOf(r.game, r.name) };
  });
  const hover: Record<string, HoverTeam> = Object.fromEntries(
    everyone.map((r) => {
      const players = r.members
        .filter((m) => m.status === "active")
        .flatMap((m) => {
          const p = profiles.get(m.handle.toLowerCase());
          const a = p?.accounts.find((x) => x.game === r.game);
          return a ? [{ handle: m.handle, role: m.role ?? a.roles[0] ?? "", score: a.rankScore, verified: a.source, checkedIn: true, karma: p!.playerKarma }] : [];
        });
      const h = hoverTeam({ id: r.id, name: r.name, captain: r.captain, players }, r.game, winsOf(r.game, r.name));
      return [r.id, { ...h, stateLabel: "Saved team", stateTone: "info" as const }];
    }),
  );
  const teamNamesOf = new Map<string, string[]>();
  for (const r of everyone) for (const m of r.members) if (m.status === "active") teamNamesOf.set(m.handle.toLowerCase(), [...(teamNamesOf.get(m.handle.toLowerCase()) ?? []), r.name]);
  const winCount = new Map<string, number>();
  for (const w of wins) for (const h of w.players) winCount.set(h.toLowerCase(), (winCount.get(h.toLowerCase()) ?? 0) + 1);
  const players: PlayerRow[] = directory
    .filter((p) => p.accounts.length > 0)
    .map((p) => ({
      handle: p.handle,
      accounts: p.accounts.map((a) => ({ game: a.game, score: a.rankScore, verified: a.source === "api" })),
      wins: winCount.get(p.handle.toLowerCase()) ?? 0,
      karma: p.playerKarma,
      recruitable: p.lookingForTeam,
      teams: teamNamesOf.get(p.handle.toLowerCase()) ?? [],
    }));
  const invites = rosters.filter((r) => r.members.some((m) => m.handle === actor && m.status === "invited"));
  const teams = rosters.filter((r) => !invites.includes(r));

  return (
    <main>
      <div className="section-h" style={{ marginTop: 0 }}>
        <h1 className="page-title">Teams</h1>
        <a href="#create-team" className="btn primary">
          Create a team
        </a>
      </div>
      <p className="muted" style={{ margin: "-4px 0 18px", maxWidth: "64ch" }}>
        Your teams, every team and player on Scheme, and the leaderboard in one place. Saved teams register for events in one step.
      </p>

      {invites.length > 0 && (
        <div className="banner info">
          <div className="btext">
            <b>Invites</b>
            {invites.map((r) => (
              <div key={r.id} className="row" style={{ marginTop: 6 }}>
                <span>
                  {r.captain} invited you to <b>{r.name}</b> ({GAMES[r.game].name}).
                </span>
                <TeamOp op="accept" rosterId={r.id}>
                  <button className="btn sm primary">Join</button>
                </TeamOp>
                <TeamOp op="decline" rosterId={r.id}>
                  <button className="btn sm">Decline</button>
                </TeamOp>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section-h">
        <h2>Your teams</h2>
        <span className="muted small">{teams.length}</span>
      </div>
      <div className="teams-grid">
        {teams.map((r) => {
          const ranks = r.members.flatMap((m) => rankOf(m.handle, r.game) ?? []);
          const avg = ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
          const won = wins.filter((w) => w.game === r.game && w.team.toLowerCase() === r.name.toLowerCase()).length;
          const captain = r.captain === actor;
          return (
            <div key={r.id} className="card panel" style={{ margin: 0 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ fontSize: 17 }}>{r.name}</h3>
                <GameBadge game={r.game} />
              </div>
              <p className="small muted" style={{ margin: "4px 0 10px" }}>
                {avg === null ? "No ranks yet" : `Average ${rankName(r.game, avg)}`} · {won} tournament
                {won === 1 ? "" : "s"} won
              </p>
              <ul className="roster">
                {r.members.map((m) => {
                  const s = rankOf(m.handle, r.game);
                  return (
                    <li key={m.handle}>
                      <span>
                        <Link href={`/u/${m.handle}`} style={{ color: "inherit" }}>
                          {m.handle}
                        </Link>
                        {m.handle === r.captain && <span className="pill quiet"> Captain</span>}
                        {m.status === "invited" && <span className="pill warn"> Invited</span>}
                      </span>
                      <span className="tiny muted">{m.role ?? "Any role"}</span>
                      <span className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <span className="mono tiny">{s === undefined ? "—" : rankShortName(r.game, s)}</span>
                        {captain && m.handle !== actor && (
                          <>
                            {m.status === "active" && (
                              <TeamOp op="captain" rosterId={r.id}>
                                <input type="hidden" name="handle" value={m.handle} />
                                <button className="btn xs ghost" title={`Make ${m.handle} captain`}>
                                  Make captain
                                </button>
                              </TeamOp>
                            )}
                            <TeamOp op="remove" rosterId={r.id}>
                              <input type="hidden" name="handle" value={m.handle} />
                              <button className="btn xs ghost danger" title={`Remove ${m.handle}`}>
                                Remove
                              </button>
                            </TeamOp>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {captain ? (
                <TeamOp op="invite" rosterId={r.id} className="row">
                  <PlayerPicker
                    name="handle"
                    game={r.game}
                    exclude={[r.captain, ...r.members.map((m) => m.handle)]}
                    placeholder="Search players to invite"
                    ariaLabel="Player to invite"
                    required
                    style={{ flex: 1, minWidth: 160 }}
                  />
                  <select name="role" aria-label="Role" defaultValue="">
                    <option value="">Any role</option>
                    {GAMES[r.game].roleOptions.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                  <button className="btn sm">Invite</button>
                </TeamOp>
              ) : (
                <TeamOp op="remove" rosterId={r.id}>
                  <input type="hidden" name="handle" value={actor} />
                  <button className="btn sm danger">Leave team</button>
                </TeamOp>
              )}
            </div>
          );
        })}
        <div id="create-team" className="card panel" style={{ margin: 0, borderStyle: "dashed", scrollMarginTop: 90 }}>
          <h3 style={{ fontSize: 17 }}>Create a team</h3>
          <p className="small muted" style={{ margin: "4px 0 12px" }}>
            You&apos;ll be captain. Invite teammates once it&apos;s made.
          </p>
          <TeamOp op="create" className="stack">
            <label className="field">
              <span>Team name</span>
              <input name="name" required minLength={2} maxLength={40} />
            </label>
            <label className="field">
              <span>Game</span>
              <select name="game" defaultValue="val">
                {(Object.keys(GAMES) as GameId[]).map((g) => (
                  <option key={g} value={g}>
                    {GAMES[g].name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <button className="btn primary">Create team</button>
            </div>
          </TeamOp>
        </div>
            </div>

      <div style={{ marginTop: 28 }}>
        <TeamLibrary
          teams={library}
          players={players}
          hover={hover}
          myRosters={teams.filter((r) => r.captain === actor).map((r) => ({ id: r.id, name: r.name, game: r.game, members: r.members.map((m) => m.handle) }))}
          initialView={sp.view === "players" ? "players" : "teams"}
        />
      </div>
    </main>
  );
}
