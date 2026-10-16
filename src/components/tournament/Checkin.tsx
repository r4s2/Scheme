import { rankName } from "@/engine";
import type { TournamentAgg } from "@/server/model";
import ui from "../ui.module.css";
import { Hidden, Op } from "./Op";

/**
 * The host's check-in view: who's in on each team, "Mark in" to check a
 * player in by hand, and Reject for a team that can't play (it forfeits its
 * matches once the event starts). Rejecting can be undone until then.
 */
export function Checkin({ agg }: { agg: TournamentAgg }) {
  const tid = agg.id;
  const tab = "checkin";
  const teams = agg.state.slots.map((id) => agg.state.teams[id]);
  const playing = teams.filter((t) => !t.rejected);
  const missing = playing.flatMap((t) => t.players.filter((p) => !p.checkedIn));
  const rejected = teams.length - playing.length;

  if (agg.status === "registration") {
    return (
      <div className={ui.card}>
        <h3>Check-in hasn&apos;t opened</h3>
        <p className={ui.lead}>Opening check-in notifies every player. You can start the tournament once enough people are in.</p>
        <Op tid={tid} op="openCheckin" tab={tab}>
          <button className={`${ui.btn} ${ui.primary}`}>Open check-in</button>
        </Op>
      </div>
    );
  }

  return (
    <>
      <div className={`${ui.card} ${missing.length ? "" : ui.cardGold}`}>
        <div className={ui.row} style={{ justifyContent: "space-between" }}>
          <div>
            <h3>{missing.length ? `${missing.length} player${missing.length === 1 ? " hasn't" : "s haven't"} checked in` : "Everyone is checked in"}</h3>
            <p className={ui.lead} style={{ margin: 0 }}>
              Mark a player in yourself if they&apos;re ready but missed the button. Reject a team that can&apos;t meet the requirements: it keeps its spot and forfeits its matches.
              {rejected ? ` ${rejected} team${rejected === 1 ? " is" : "s are"} rejected.` : ""}
            </p>
          </div>
          {agg.status === "checkin" && (
            <Op tid={tid} op="start" tab="bracket">
              <button className={`${ui.btn} ${ui.primary}`}>{missing.length ? "Start anyway" : "Start tournament"}</button>
            </Op>
          )}
        </div>
      </div>
      <div className="checkin-grid">
        {teams.map((t) => {
          const inCount = t.players.filter((p) => p.checkedIn).length;
          return (
            <div key={t.id} className={`${ui.card} checkin-team ${t.rejected ? "is-rejected" : ""}`}>
              <div className="checkin-head">
                <h3>{t.name}</h3>
                {t.rejected ? (
                  <span className={`${ui.pill} ${ui.pillBad}`}>Rejected</span>
                ) : (
                  <span className={`${ui.pill} ${inCount === t.players.length ? ui.pillGood : ui.pillWarn}`}>
                    {inCount}/{t.players.length} in
                  </span>
                )}
              </div>
              {t.rejected ? (
                <div className="checkin-rejected">
                  <p className={ui.small}>{t.rejected}</p>
                  {agg.status === "checkin" && (
                    <Op tid={tid} op="reinstateTeam" tab={tab}>
                      <Hidden name="teamId" value={t.id} />
                      <button className={ui.btn}>Reinstate</button>
                    </Op>
                  )}
                </div>
              ) : (
                <>
                  <ul className="checkin-list">
                    {t.players.map((p) => (
                      <li key={p.handle}>
                        <span className="who">
                          {p.handle}
                          {p.handle === t.captain && <span className={ui.muted}> (c)</span>}
                          {p.confirmation && <span className={p.confirmation === "declined" ? "picker-bad" : "picker-warn"}> {p.confirmation === "declined" ? "can't play" : "unconfirmed"}</span>}
                          <small>
                            {p.role} · {rankName(agg.game, p.score)}
                          </small>
                        </span>
                        {p.checkedIn ? (
                          <span className={`${ui.pill} ${ui.pillGood}`}>In</span>
                        ) : (
                          <Op tid={tid} op="markCheckedIn" tab={tab}>
                            <Hidden name="teamId" value={t.id} />
                            <Hidden name="handle" value={p.handle} />
                            <button className={ui.btn}>Mark in</button>
                          </Op>
                        )}
                      </li>
                    ))}
                  </ul>
                  {t.bench && t.bench.length > 0 && (
                    <p className={`${ui.small} ${ui.muted}`} style={{ margin: "8px 0 0" }}>
                      Subs: {t.bench.map((p) => `${p.handle} (${p.role})`).join(", ")}
                    </p>
                  )}
                  {agg.status === "checkin" && (
                    <details className="checkin-reject">
                      <summary>Reject team</summary>
                      <Op tid={tid} op="rejectTeam" tab={tab} className="checkin-reject-form">
                        <Hidden name="teamId" value={t.id} />
                        <input name="reason" maxLength={200} placeholder="Reason, sent to the team (optional)" aria-label={`Why ${t.name} is rejected`} />
                        <button className={`${ui.btn} ${ui.danger}`}>Reject {t.name}</button>
                      </Op>
                    </details>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
