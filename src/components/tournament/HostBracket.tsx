import { canReopen, canTransform, FORMAT_NAMES, lockedSlots, resultOf, scoreOptions, type FormatId } from "@/engine";
import { Board } from "@/components/bracket/Board";
import { SeedIcon, ShuffleIcon, TransformIcon } from "@/components/ui/icons";
import { formatWhen, statusText } from "@/lib/format";
import type { TournamentAgg } from "@/server/model";
import { bracketOf, deadlineOf, statusOf } from "@/server/views";
import ui from "../ui.module.css";
import { Hidden, Op } from "./Op";

const FORMATS = Object.keys(FORMAT_NAMES) as FormatId[];

export function HostBracket({ agg, now, editable, wins }: { agg: TournamentAgg; now: Date; editable: boolean; wins: Record<string, number> }) {
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
        <div className="toolbar">
          <Op tid={tid} op="randomize" tab={tab}>
            <button className="btn sm" title="Shuffle every unlocked team into a new slot">
              <ShuffleIcon />
              Randomize
            </button>
          </Op>
          <Op tid={tid} op="seed" tab={tab}>
            <button className="btn sm" title="Seed by average verified rank: 1 vs last, 2 vs second-last">
              <SeedIcon />
              Auto-seed by rank
            </button>
          </Op>
          <Op tid={tid} op="transform" tab={tab}>
            <select name="format" defaultValue={FORMATS.find((f) => f !== agg.state.format)} disabled={!tf} aria-label="New format" style={{ padding: "5px 8px", fontSize: 13 }}>
              {FORMATS.filter((f) => f !== agg.state.format).map((f) => (
                <option key={f} value={f}>
                  {FORMAT_NAMES[f]}
                </option>
              ))}
            </select>
            <button className="btn sm" disabled={!tf} title={tf ? "Change the format, keeping first-round results" : "Locked once results go past round one"}>
              <TransformIcon />
              Transform
            </button>
          </Op>
          {agg.state.format !== "rr" && (
            <Op tid={tid} op="swap" tab={tab}>
              <select name="a" aria-label="First team" style={{ padding: "5px 8px", fontSize: 13, maxWidth: 160 }}>
                {agg.state.slots.map((s, i) => (
                  <option key={s} value={i} disabled={locked.has(i)}>
                    {name(s)}
                  </option>
                ))}
              </select>
              <span className={ui.muted}>⇄</span>
              <select name="b" defaultValue={1} aria-label="Second team" style={{ padding: "5px 8px", fontSize: 13, maxWidth: 160 }}>
                {agg.state.slots.map((s, i) => (
                  <option key={s} value={i} disabled={locked.has(i)}>
                    {name(s)}
                  </option>
                ))}
              </select>
              <button className="btn sm">Swap</button>
            </Op>
          )}
          <span className="hint">
            {agg.state.format !== "rr" ? "Drag a first-round team onto another to swap them. " : ""}
            {locked.size ? `${locked.size} team${locked.size === 1 ? " is" : "s are"} locked by results. ` : ""}Every change is logged.
          </span>
        </div>
      )}

      <Board
        state={agg.state}
        game={agg.game}
        status={(m) => statusOf(agg, m, now)}
        deadline={(m) => deadlineOf(agg, m)}
        edit={editable ? { tid, tab, results: agg.status === "live" } : undefined}
        wins={wins}
        phase={agg.status === "checkin" ? "checkin" : "play"}
      />

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
