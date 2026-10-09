import { rankName, rankSubs } from "@/engine";
import type { TournamentAgg } from "@/server/model";
import ui from "../ui.module.css";
import { Hidden, Op } from "./Op";

export function Checkin({ agg }: { agg: TournamentAgg }) {
  const tid = agg.id;
  const tab = "checkin";
  const teams = agg.state.slots.map((id) => agg.state.teams[id]);
  const missing = teams.flatMap((t) => t.players.filter((p) => !p.checkedIn).map((p) => ({ team: t, p })));

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
            <h3>{missing.length ? `${missing.length} player${missing.length === 1 ? "" : "s"} haven't checked in` : "Everyone is checked in"}</h3>
            <p className={ui.lead}>Replace a no-show with a free agent; the closest rank in the same role is listed first.</p>
          </div>
          {agg.status === "checkin" && (
            <Op tid={tid} op="start" tab="bracket">
              <button className={`${ui.btn} ${ui.primary}`}>{missing.length ? "Start anyway" : "Start tournament"}</button>
            </Op>
          )}
        </div>
      </div>
      <div className={ui.grid2}>
        {teams.map((t) => (
          <div key={t.id} className={ui.card}>
            <div className={ui.row} style={{ justifyContent: "space-between" }}>
              <h3>{t.name}</h3>
              <span className={`${ui.pill} ${t.players.every((p) => p.checkedIn) ? ui.pillGood : ui.pillWarn}`}>
                {t.players.filter((p) => p.checkedIn).length}/{t.players.length} in
              </span>
            </div>
            <table className={ui.table}>
              <tbody>
                {t.players.map((p) => (
                  <tr key={p.handle}>
                    <td>
                      {p.handle}
                      {p.handle === t.captain && <span className={ui.muted}> (c)</span>}
                    </td>
                    <td className={ui.small}>
                      {p.role} · {rankName(agg.game, p.score)}
                    </td>
                    <td>
                      {p.checkedIn ? (
                        <span className={`${ui.pill} ${ui.pillGood}`}>In</span>
                      ) : (
                        <div className={ui.row}>
                          <Op tid={tid} op="markCheckedIn" tab={tab}>
                            <Hidden name="teamId" value={t.id} />
                            <Hidden name="handle" value={p.handle} />
                            <button className={ui.btn}>Mark in</button>
                          </Op>
                          {agg.subs.length > 0 && (
                            <Op tid={tid} op="replaceWithSub" tab={tab}>
                              <Hidden name="teamId" value={t.id} />
                              <Hidden name="handle" value={p.handle} />
                              <select name="sub" aria-label={`Sub for ${p.handle}`}>
                                {rankSubs(p, agg.subs).map((s) => (
                                  <option key={s.handle} value={s.handle}>
                                    {s.handle} · {s.role} · {rankName(agg.game, s.score)}
                                  </option>
                                ))}
                              </select>
                              <button className={ui.btn}>Replace</button>
                            </Op>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
