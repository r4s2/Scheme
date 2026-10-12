import { canReopen, resultOf, scoreOptions } from "@/engine";
import { BracketBoard } from "@/components/bracket/BracketBoard";
import { boardProps } from "@/components/bracket/props";
import { formatWhen, statusText } from "@/lib/format";
import type { TournamentAgg } from "@/server/model";
import { bracketOf, deadlineOf, statusOf } from "@/server/views";
import ui from "../ui.module.css";
import { Hidden, Op } from "./Op";

export function HostBracket({ agg, now, editable, wins }: { agg: TournamentAgg; now: Date; editable: boolean; wins: Record<string, number> }) {
  const b = bracketOf(agg);
  const tid = agg.id;
  const tab = "bracket";
  const name = (id: string | null) => (id ? agg.state.teams[id]?.name ?? id : "TBD");
  const open = b.matches.filter((m) => m.a && m.b && !resultOf(agg.state, m));
  const reopenable = b.matches.filter((m) => canReopen(agg.state, b, m));
  const opts = scoreOptions(agg.state.bestOf);

  return (
    <>
      <BracketBoard {...boardProps(agg, now, { wins, host: editable ? { arrange: true, results: agg.status === "live" } : undefined })} />

      {editable && agg.status === "live" && (
        <div className={ui.card} style={{ marginTop: 16 }}>
          <h3>All matches</h3>
          <p className={ui.lead}>Every open match with its deadline. You can also enter or reopen results right on the bracket.</p>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Status</th>
                  <th>Deadline</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {open.map((m) => {
                  const d = deadlineOf(agg, m);
                  return (
                    <tr key={m.id} id={`result-${m.id}`}>
                      <td>
                        <b>{m.id}</b> · {name(m.a)} vs {name(m.b)}
                      </td>
                      <td>{statusText(statusOf(agg, m, now))}</td>
                      <td className={ui.small}>{d ? formatWhen(d) : "—"}</td>
                      <td>
                        <Op tid={tid} op="recordResult" tab={tab}>
                          <Hidden name="matchId" value={m.id} />
                          <select name="winner" aria-label="Winner">
                            <option value={m.a!}>{name(m.a)} won</option>
                            <option value={m.b!}>{name(m.b)} won</option>
                          </select>
                          <select name="score" aria-label="Score">
                            {opts.map(([w, l]) => (
                              <option key={`${w}-${l}`} value={`${w}-${l}`}>
                                {w}–{l}
                              </option>
                            ))}
                          </select>
                          <label className={ui.check}>
                            <input type="checkbox" name="forfeit" /> Forfeit
                          </label>
                          <button className={`${ui.btn} ${ui.primary}`}>Save</button>
                        </Op>
                      </td>
                    </tr>
                  );
                })}
                {reopenable.map((m) => {
                  const r = resultOf(agg.state, m)!;
                  return (
                    <tr key={m.id}>
                      <td>
                        <b>{m.id}</b> · {name(m.a)} vs {name(m.b)}
                      </td>
                      <td>{r.by === "forfeit" ? "Forfeit" : "Final"}</td>
                      <td className={ui.small}>—</td>
                      <td>
                        <span className={ui.small}>
                          {name(r.winner)} won {r.by === "forfeit" ? "by forfeit" : `${r.w}–${r.l}`}{" "}
                        </span>
                        <Op tid={tid} op="reopen" tab={tab}>
                          <Hidden name="matchId" value={m.id} />
                          <button className={`${ui.btn} ${ui.danger}`}>Reopen</button>
                        </Op>
                      </td>
                    </tr>
                  );
                })}
                {!open.length && !reopenable.length && (
                  <tr>
                    <td colSpan={4} className={ui.muted}>
                      Nothing to enter right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
