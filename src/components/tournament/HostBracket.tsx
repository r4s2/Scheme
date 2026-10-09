import { canReopen, canTransform, FORMAT_NAMES, lockedSlots, resultOf, scoreOptions, type FormatId } from "@/engine";
import { BracketView } from "@/components/BracketView";
import { formatWhen, statusText } from "@/lib/format";
import type { TournamentAgg } from "@/server/model";
import { bracketOf, deadlineOf, statusOf } from "@/server/views";
import ui from "../ui.module.css";
import { Hidden, Op } from "./Op";

const FORMATS = Object.keys(FORMAT_NAMES) as FormatId[];

export function HostBracket({ agg, now, editable }: { agg: TournamentAgg; now: Date; editable: boolean }) {
  const b = bracketOf(agg);
  const tid = agg.id;
  const tab = "bracket";
  const locked = lockedSlots(agg.state, agg.state.slots, agg.state.format);
  const name = (id: string | null) => (id ? agg.state.teams[id]?.name ?? id : "TBD");
  const open = b.matches.filter((m) => m.a && m.b && !resultOf(agg.state, m));
  const reopenable = b.matches.filter((m) => canReopen(agg.state, b, m));
  const opts = scoreOptions(agg.state.bestOf);
  const tf = canTransform(agg.state);

  return (
    <>
      {editable && (
        <div className={ui.card}>
          <h3>Edit the bracket</h3>
          <p className={ui.lead}>
            Teams with a confirmed result are locked{locked.size ? ` (${locked.size} right now)` : ""}. Every change is logged and the affected teams are notified.
          </p>
          <div className={ui.row}>
            <Op tid={tid} op="randomize" tab={tab}>
              <button className={ui.btn}>Randomize</button>
            </Op>
            <Op tid={tid} op="seed" tab={tab}>
              <button className={ui.btn}>Auto-seed by rank</button>
            </Op>
            <Op tid={tid} op="transform" tab={tab}>
              <select name="format" defaultValue={FORMATS.find((f) => f !== agg.state.format)} disabled={!tf} aria-label="New format">
                {FORMATS.filter((f) => f !== agg.state.format).map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_NAMES[f]}
                  </option>
                ))}
              </select>
              <button className={ui.btn} disabled={!tf} title={tf ? undefined : "Locked once results go past round one"}>
                Transform
              </button>
            </Op>
            {agg.state.format !== "rr" && (
              <Op tid={tid} op="swap" tab={tab}>
                <select name="a" aria-label="First team">
                  {agg.state.slots.map((s, i) => (
                    <option key={s} value={i} disabled={locked.has(i)}>
                      {name(s)}
                    </option>
                  ))}
                </select>
                <span className={ui.muted}>⇄</span>
                <select name="b" defaultValue={1} aria-label="Second team">
                  {agg.state.slots.map((s, i) => (
                    <option key={s} value={i} disabled={locked.has(i)}>
                      {name(s)}
                    </option>
                  ))}
                </select>
                <button className={ui.btn}>Swap</button>
              </Op>
            )}
          </div>
        </div>
      )}

      <BracketView state={agg.state} game={agg.game} />

      {editable && agg.status === "live" && (
        <div className={ui.card} style={{ marginTop: 16 }}>
          <h3>Results</h3>
          <p className={ui.lead}>Enter a result yourself when captains can&apos;t, or fix one before a later match depends on it.</p>
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
                    <tr key={m.id}>
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
