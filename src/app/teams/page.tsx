import Link from "next/link";
import { GAMES, rankName, rankShortName, type GameId } from "@/engine";
import { TeamOp } from "@/components/teams/TeamOp";
import { GameBadge } from "@/components/ui/bits";
import { getStore } from "@/server/store";
import { currentActor } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teams · Scheme" };

export default async function TeamsPage() {
  const actor = await currentActor();
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
  const [rosters, wins] = await Promise.all([store.rosters(actor), store.wins()]);
  const handles = [...new Set(rosters.flatMap((r) => r.members.map((m) => m.handle)))];
  const profiles = new Map((await store.profiles(handles)).map((p) => [p.handle.toLowerCase(), p]));
  const rankOf = (h: string, g: GameId) => profiles.get(h.toLowerCase())?.accounts.find((a) => a.game === g)?.rankScore;
  const invites = rosters.filter((r) => r.members.some((m) => m.handle === actor && m.status === "invited"));
  const teams = rosters.filter((r) => !invites.includes(r));

  return (
    <main>
      <div className="section-h" style={{ marginTop: 0 }}>
        <h1 className="page-title">Teams</h1>
      </div>
      <p className="muted" style={{ margin: "-4px 0 18px", maxWidth: "60ch" }}>
        Saved teams register for events in one step. Scheme checks every member&apos;s linked rank against an event&apos;s requirements when you register.
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
                  <input name="handle" placeholder="Invite by handle" required aria-label="Player to invite" style={{ flex: 1, minWidth: 120 }} />
                  <select name="role" aria-label="Role" defaultValue="">
                    <option value="">Any role</option>
                    {[...new Set(GAMES[r.game].roles)].map((x) => (
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
        <div className="card panel" style={{ margin: 0, borderStyle: "dashed" }}>
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
    </main>
  );
}
