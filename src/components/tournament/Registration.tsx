import { rankShortName } from "@/engine";
import { hoverTeam } from "@/components/bracket/hover";
import { HoverLayer } from "@/components/bracket/HoverLayer";
import { CheckIcon, WarnIcon } from "@/components/ui/icons";
import { startText } from "@/lib/format";
import type { TournamentAgg } from "@/server/model";
import { capacity, registeredCount } from "@/server/registration";
import { Hidden, Op } from "./Op";
import { TeamSignup, type RosterOption } from "./TeamSignup";

export interface SignupContext {
  actor: string | null;
  /** Saved teams the viewer captains for this game, with each member's eligibility. */
  rosters: RosterOption[];
  /** Why the viewer can't sign up solo, or null if they can. */
  soloBlocker: string | null;
}

/** While sign-ups are open: who's in, signing up (team or solo), and the host's controls. */
export function Registration({ agg, now, isHost, wins, signup }: { agg: TournamentAgg; now: Date; isHost: boolean; wins: Record<string, number>; signup: SignupContext }) {
  const teams = Object.values(agg.state.teams);
  const solo = agg.signupType === "solo";
  const cap = capacity(agg);
  const registered = registeredCount(agg);
  const full = registered >= cap;
  const built = solo && teams.length > 0;
  const pct = Math.min(100, (registered / cap) * 100);
  const hover = Object.fromEntries(teams.map((t) => [t.id, hoverTeam(t, agg.game, wins[t.name.toLowerCase()] ?? 0, "registration")]));
  const me = signup.actor;
  const myTeam = me ? teams.find((t) => t.players.some((p) => p.handle === me)) : undefined;
  const mySolo = me ? agg.pool.find((p) => p.handle === me) : undefined;
  const canOpen = teams.length === agg.teamCount;

  return (
    <>
      <div className={`banner ${full ? "gold" : "info"}`}>
        <div className="btext">
          <b>
            Registration is open · {registered} of {cap} {solo ? "players" : "teams"}
          </b>
          <span className="small">
            {full ? "Full. " : `${cap - registered} spot${cap - registered === 1 ? "" : "s"} left. `}
            Starts {startText(agg.startsAt, now)}. {solo ? (built ? "Teams are built." : `When registration closes, Scheme balances everyone into teams of ${agg.roles.length}.`) : "Captains register their whole team."}
          </span>
        </div>
        {isHost && solo && !built && (
          <Op tid={agg.id} op="buildTeams">
            <button className="btn sm" disabled={!full} title={full ? "Build balanced teams from the sign-ups" : `Needs ${cap} players`}>
              Build teams
            </button>
          </Op>
        )}
        {isHost && (
          <Op tid={agg.id} op="openCheckin">
            <button className="btn sm primary" disabled={!canOpen} title={canOpen ? undefined : solo ? "Build teams first" : "Opens when every spot is filled"}>
              Open check-in
            </button>
          </Op>
        )}
      </div>
      <div className="fill" style={{ marginBottom: 18 }} role="presentation">
        <span style={{ width: `${pct}%` }} />
      </div>

      {/* Signing up */}
      {me && !isHost && (
        <div className="card panel">
          {myTeam ? (
            <div className="row" style={{ justifyContent: "space-between" }}>
              <p>
                You&apos;re registered with <b>{myTeam.name}</b>
                {myTeam.captain === me ? " as captain." : `, captained by ${myTeam.captain}.`}
              </p>
              {myTeam.captain === me && !built && (
                <Op tid={agg.id} op="withdrawTeam">
                  <Hidden name="teamId" value={myTeam.id} />
                  <button className="btn sm danger">Withdraw team</button>
                </Op>
              )}
            </div>
          ) : mySolo ? (
            <div className="row" style={{ justifyContent: "space-between" }}>
              <p>
                You&apos;re signed up as <b>{mySolo.role}</b>. Scheme builds the teams when registration closes.
              </p>
              <Op tid={agg.id} op="leaveSolo">
                <button className="btn sm danger">Withdraw</button>
              </Op>
            </div>
          ) : full ? (
            <p className="muted">This event is full.</p>
          ) : solo ? (
            <>
              <h3>Sign up solo</h3>
              {signup.soloBlocker ? (
                <p className="small" style={{ color: "var(--bad)" }}>
                  {signup.soloBlocker}
                </p>
              ) : (
                <Op tid={agg.id} op="joinSolo" className="row">
                  <label className="small" htmlFor="solo-role">
                    I want to play
                  </label>
                  <select id="solo-role" name="role">
                    {[...new Set(agg.roles)].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <button className="btn sm primary">Sign up</button>
                </Op>
              )}
            </>
          ) : (
            <TeamSignup tid={agg.id} roles={agg.roles} rosters={signup.rosters} actor={me} />
          )}
        </div>
      )}

      {solo && !built ? (
        <div className="card panel">
          <h3>Solo sign-ups</h3>
          <p className="lead">Verified ranks and preferred roles. The balancer uses these to build even teams.</p>
          {agg.pool.length === 0 ? (
            <p className="muted small">Nobody yet.</p>
          ) : (
            <div className="tblwrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Role</th>
                    <th className="num">Rank</th>
                    <th className="num">Karma</th>
                  </tr>
                </thead>
                <tbody>
                  {agg.pool.map((p) => (
                    <tr key={p.handle}>
                      <td>
                        <a href={`/u/${p.handle}`} style={{ color: "inherit" }}>
                          {p.handle}
                        </a>
                      </td>
                      <td className="muted">{p.role}</td>
                      <td className="num">
                        {rankShortName(agg.game, p.score)}{" "}
                        <span className={`vmark ${p.verified === "self" ? "self" : ""}`} title={p.verified === "self" ? "Self-reported rank" : "Verified rank"}>
                          {p.verified === "self" ? <WarnIcon /> : <CheckIcon />}
                        </span>
                      </td>
                      <td className="num">{p.karma ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <HoverLayer teams={hover}>
          <div className="reg-grid">
            {teams.map((t, i) => (
              <div key={t.id} className="card" style={{ padding: "10px 12px" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="team static" data-team={t.id} tabIndex={0} style={{ flex: 1 }}>
                    <span className="tn">
                      <b>{t.name}</b>
                    </span>
                    <span className="tr">{hover[t.id].avgRank}</span>
                  </span>
                  <span className="mono tiny muted">#{i + 1}</span>
                </div>
                <div className="row" style={{ justifyContent: "space-between", padding: "0 6px" }}>
                  <p className="tiny muted">
                    Captain {t.captain} · {t.players.length} players
                  </p>
                  {isHost && !solo && (
                    <Op tid={agg.id} op="withdrawTeam">
                      <Hidden name="teamId" value={t.id} />
                      <button className="btn xs ghost danger" title={`Remove ${t.name} from the event`}>
                        Remove
                      </button>
                    </Op>
                  )}
                </div>
              </div>
            ))}
            {Array.from({ length: Math.max(0, agg.teamCount - teams.length) }, (_, i) => (
              <div key={`open-${i}`} className="card" style={{ padding: "10px 12px", borderStyle: "dashed", background: "none" }}>
                <span className="muted small">Open spot</span>
              </div>
            ))}
          </div>
        </HoverLayer>
      )}
      {built && agg.subs.length > 0 && (
        <p className="small muted" style={{ marginTop: 12 }}>
          Subs: {agg.subs.map((s) => `${s.handle} (${s.role})`).join(", ")}
        </p>
      )}
    </>
  );
}
