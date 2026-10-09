import { formatCents, rankName, resultOf, scoreOptions, averageScore } from "@/engine";
import { LOBBY_STEPS } from "@/lib/lobby";
import { formatWhen, statusText } from "@/lib/format";
import type { TournamentAgg } from "@/server/model";
import { captainOf, teamOf } from "@/server/operations";
import { bracketOf, currentMatchFor, deadlineOf, statusOf } from "@/server/views";
import ui from "../ui.module.css";
import { Hidden, Op } from "./Op";

export function PlayerMatch({ agg, actor, now }: { agg: TournamentAgg; actor: string; now: Date }) {
  const tid = agg.id;
  const tab = "match";
  const teamId = teamOf(agg, actor);
  if (!teamId) return <p className={ui.muted}>You aren&apos;t on a team in this tournament. You can follow the bracket.</p>;
  const team = agg.state.teams[teamId];
  const isCaptain = captainOf(agg, actor) === teamId;
  const name = (id: string | null) => (id ? agg.state.teams[id]?.name ?? id : "TBD");

  const myPayouts = agg.payouts.filter((p) => p.handle === actor);
  const prizeBox =
    myPayouts.length > 0 ? (
      <div className={`${ui.card} ${ui.cardGold}`}>
        <h3>Your prize: {formatCents(myPayouts.reduce((s, p) => s + p.cents, 0))}</h3>
        {myPayouts.every((p) => p.status === "claimed") ? (
          <p className={ui.small}>Claimed. It&apos;s on its way to your payout account.</p>
        ) : myPayouts.some((p) => p.status === "claimable") ? (
          <Op tid={tid} op="claim" tab={tab}>
            <button className={`${ui.btn} ${ui.gold}`}>Claim prize</button>
          </Op>
        ) : (
          <p className={ui.small}>Ready to claim after {formatWhen(myPayouts[0].releaseAt)}, when the dispute window closes.</p>
        )}
      </div>
    ) : null;

  if (agg.status === "complete" || agg.status === "cancelled") return prizeBox;

  if (agg.status === "registration" || agg.status === "checkin") {
    const me = team.players.find((p) => p.handle === actor)!;
    return (
      <div className={ui.grid2}>
        <div className={ui.card}>
          <h3>{agg.status === "checkin" ? "Check in" : "You're registered"}</h3>
          {agg.status === "registration" ? (
            <p className={ui.lead}>Check-in opens before the start. You&apos;ll get a notification.</p>
          ) : me.checkedIn ? (
            <span className={`${ui.pill} ${ui.pillGood}`}>You&apos;re checked in</span>
          ) : (
            <Op tid={tid} op="checkIn" tab={tab}>
              <button className={`${ui.btn} ${ui.primary}`}>Check in</button>
            </Op>
          )}
        </div>
        <div className={ui.card}>
          <h3>Your team: {team.name}</h3>
          <table className={ui.table}>
            <tbody>
              {team.players.map((p) => (
                <tr key={p.handle}>
                  <td>
                    {p.handle}
                    {p.handle === actor && " (you)"}
                    {p.handle === team.captain && <span className={ui.muted}> (c)</span>}
                  </td>
                  <td className={ui.small}>
                    {p.role} · {rankName(agg.game, p.score)}
                  </td>
                  <td>{p.checkedIn ? <span className={`${ui.pill} ${ui.pillGood}`}>In</span> : <span className={ui.muted}>Not yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const m = currentMatchFor(agg, teamId);
  if (!m) return <p className={ui.muted}>Your next match appears here once the bracket sets it.</p>;
  const opp = m.a === teamId ? m.b! : m.a!;
  const r = resultOf(agg.state, m);
  const st = statusOf(agg, m, now);
  const dl = deadlineOf(agg, m);
  const myReport = agg.reports.find((x) => x.matchId === m.id && x.teamId === teamId);
  const disputed = agg.disputes.some((d) => d.matchId === m.id && d.status === "open");
  const pendingExt = agg.extensions.find((x) => x.matchId === m.id && x.teamId === teamId && x.status === "pending");
  const lobbyOwner = averageScore(agg.state.teams[teamId]) >= averageScore(agg.state.teams[opp]) ? teamId : opp;
  const alive = bracketOf(agg).standings.find((s) => s.teamId === teamId)?.alive;

  return (
    <div className={ui.grid2}>
      <div>
        <div className={ui.card}>
          <div className={ui.versus}>
            <div>
              <b>{team.name}</b>
              <span className={ui.small}>{rankName(agg.game, averageScore(team))}</span>
            </div>
            <span className={`${ui.mono} ${ui.muted}`}>
              {m.id} · Bo{agg.state.bestOf}
            </span>
            <div className={ui.right}>
              <b>{name(opp)}</b>
              <span className={ui.small}>{rankName(agg.game, averageScore(agg.state.teams[opp]))}</span>
            </div>
          </div>
          {!r && (
            <p className={ui.small} style={{ marginTop: 12 }}>
              <span className={`${ui.pill} ${st.kind === "overdue" ? ui.pillBad : ui.pillWarn}`}>{statusText(st)}</span>{" "}
              {dl && <>Deadline {formatWhen(dl)}.</>} Report within the deadline.{" "}
              {agg.allowExtensions ? "Captains can ask the host for more time." : "Extensions are off; a missed deadline is a forfeit."}
            </p>
          )}
        </div>
        {!r && (
          <div className={ui.card}>
            <h3>Lobby instructions</h3>
            <p className={ui.lead}>Scheme doesn&apos;t create the lobby. One captain sets it up and invites the other team.</p>
            <ol className={ui.steps}>
              <li>
                <b>{name(lobbyOwner)}</b> creates the lobby (higher average rank).
              </li>
              {LOBBY_STEPS[agg.game].map((s) => (
                <li key={s}>{s}</li>
              ))}
              {agg.houseRules.map((s) => (
                <li key={s}>House rule: {s}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <div>
        {prizeBox}
        <div className={ui.card}>
          <h3>{r ? "Result" : "Report the result"}</h3>
          {r ? (
            <p className={ui.small}>
              <span className={`${ui.pill} ${r.winner === teamId ? ui.pillGood : ""}`}>{r.winner === teamId ? "Won" : "Lost"}</span> {name(r.winner)}{" "}
              {r.by === "forfeit" ? "won by forfeit" : `won ${r.w}–${r.l}`}.{" "}
              {r.winner === teamId ? "Your next match shows up here when the bracket sets it." : alive ? "You drop to the next stage of the bracket." : "Your team is out. Thanks for playing."}
            </p>
          ) : disputed ? (
            <p className={ui.small}>
              <span className={`${ui.pill} ${ui.pillBad}`}>Disputed</span> The captains&apos; reports don&apos;t match. The host will decide and you&apos;ll get a notification.
            </p>
          ) : myReport ? (
            <p className={ui.small}>
              <span className={`${ui.pill} ${ui.pillInfo}`}>Waiting</span> You reported {name(myReport.winner)} won {myReport.w}–{myReport.l}. {name(opp)} has until{" "}
              {formatWhen(new Date(Date.parse(myReport.createdAt) + 12 * 3_600_000))} to confirm or dispute; after that it confirms automatically.
            </p>
          ) : isCaptain ? (
            <Op tid={tid} op="report" tab={tab} className={ui.stack}>
              <Hidden name="matchId" value={m.id} />
              <label className={ui.field}>
                Final score
                <select name="result">
                  {scoreOptions(agg.state.bestOf).flatMap(([w, l]) =>
                    [teamId, opp].map((winner) => (
                      <option key={`${winner}-${w}-${l}`} value={`${winner}|${w}|${l}`}>
                        {name(winner)} won {w}–{l}
                      </option>
                    )),
                  )}
                </select>
              </label>
              <div>
                <button className={`${ui.btn} ${ui.primary}`}>Submit result</button>
              </div>
            </Op>
          ) : (
            <p className={`${ui.small} ${ui.muted}`}>Your captain, {team.captain}, reports results.</p>
          )}
        </div>
        {!r && isCaptain && agg.allowExtensions && (
          <div className={ui.card}>
            <h3>Need more time?</h3>
            {pendingExt ? (
              <p className={ui.small}>
                <span className={`${ui.pill} ${ui.pillInfo}`}>Sent</span> You asked for {pendingExt.hours} more hour{pendingExt.hours === 1 ? "" : "s"}. The host will decide.
              </p>
            ) : (
              <Op tid={tid} op="requestExtension" tab={tab} className={ui.stack}>
                <Hidden name="matchId" value={m.id} />
                <label className={ui.field}>
                  Extra time
                  <select name="hours" defaultValue="3">
                    {[1, 3, 12, 24].map((h) => (
                      <option key={h} value={h}>
                        {h} hour{h === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={ui.field}>
                  Reason
                  <input name="reason" placeholder="Two players get off work late" />
                </label>
                <div>
                  <button className={ui.btn}>Request extension</button>
                </div>
              </Op>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
