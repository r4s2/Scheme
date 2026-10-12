import { averageScore, buildBracket, GAMES, lockedSlots, rankShortName, resultOf, type GameId, type Match, type MatchStatus, type Team, type TournamentState } from "@/engine";
import { formatWhen, statusText } from "@/lib/format";
import { BoardClient, type HoverTeam } from "./BoardClient";

export interface BoardProps {
  state: TournamentState;
  game: GameId;
  /** Match status for live events (deadlines, overdue, disputes). */
  status?: (m: Match) => MatchStatus | null;
  /** Deadline for a match, shown on hover of its status. */
  deadline?: (m: Match) => Date | null;
  /** The viewer's team, highlighted. */
  mine?: string | null;
  /** Host editing: drag to swap teams, and "Enter result" links on open matches. */
  edit?: { tid: string; tab: string; results: boolean };
  /** Tournaments won per team name, for hover cards. */
  wins?: Record<string, number>;
  /** "Checked in" while checking in; "Registered" before that. */
  phase?: "registration" | "checkin" | "play";
}

/** Hover card data for every team in a tournament. */
export function hoverTeams(state: TournamentState, game: GameId, wins: Record<string, number> = {}, phase: BoardProps["phase"] = "play"): Record<string, HoverTeam> {
  const out: Record<string, HoverTeam> = {};
  for (const t of Object.values(state.teams)) out[t.id] = hoverTeam(t, game, wins[t.name.toLowerCase()] ?? 0, phase);
  return out;
}

export function hoverTeam(t: Team, game: GameId, wins: number, phase: BoardProps["phase"] = "play"): HoverTeam {
  const karma = t.players.filter((p) => p.karma != null);
  const allIn = t.players.every((p) => p.checkedIn);
  return {
    name: t.name,
    captain: t.captain,
    avgRank: rankShortName(game, averageScore(t)),
    karma: karma.length ? Math.round(karma.reduce((s, p) => s + (p.karma ?? 0), 0) / karma.length) : null,
    wins,
    gameShort: GAMES[game].name.split(" ")[0],
    stateLabel: phase === "registration" ? "Registered" : allIn ? "Checked in" : "Not all checked in",
    stateTone: phase === "registration" ? "info" : allIn ? "good" : "warn",
    players: t.players.map((p) => ({ handle: p.handle, role: p.role, rank: rankShortName(game, p.score), verified: p.verified, checkedIn: p.checkedIn })),
  };
}

const ST_CLASS: Partial<Record<MatchStatus["kind"], string>> = { final: "done", forfeit: "done", overdue: "over", due: "due", disputed: "over", awaiting_confirm: "due" };

/**
 * The bracket board from the prototype: dot-grid canvas, match cards with
 * status, connector wires, team hover cards, and drag-to-swap for hosts.
 * Renders every format the engine supports.
 */
export function Board({ state, game, status, deadline, mine, edit, wins, phase = "play" }: BoardProps) {
  const bracket = buildBracket(state);
  const locked = edit ? lockedSlots(state, state.slots, state.format) : new Set<number>();
  const name = (id: string | null) => (id ? (state.teams[id]?.name ?? id) : null);

  const teamChip = (id: string | null, slot: number | undefined, placeholder?: string) => {
    if (!id) return <span className="team tbd">{placeholder ?? "TBD"}</span>;
    const draggable = !!edit && slot !== undefined && !locked.has(slot);
    return (
      <span
        className={`team ${id === mine ? "is-mine" : ""} ${draggable ? "" : "static"}`}
        data-team={id}
        data-slot={slot}
        data-locked={slot !== undefined && locked.has(slot) ? "true" : undefined}
        draggable={draggable || undefined}
        tabIndex={0}
        aria-disabled={!draggable || undefined}
        title={draggable ? "Drag onto another first-round team to swap them" : undefined}
      >
        <span className="tn">{name(id)}</span>
        <span className="tr">{rankShortName(game, averageScore(state.teams[id]))}</span>
      </span>
    );
  };

  const matchCard = (m: Match) => {
    const r = resultOf(state, m);
    const st = status?.(m) ?? null;
    const cls = r ? "done" : st ? (ST_CLASS[st.kind] ?? "") : "";
    const text = r ? (r.by === "forfeit" ? "Forfeit" : "Final") : st ? statusText(st) : m.a && m.b ? "Open" : "Waiting";
    const due = !r && m.a && m.b ? deadline?.(m) : null;
    const row = (id: string | null, slot: number | undefined, placeholder?: string) => {
      const won = !!r && r.winner === id;
      const score = r ? (r.by === "forfeit" ? (won ? "W" : "FF") : won ? r.w : r.l) : "";
      return (
        <div className={`slot ${won ? "win" : r ? "lose" : ""}`}>
          {teamChip(id, slot, placeholder)}
          <span className="score">{score}</span>
        </div>
      );
    };
    const isMine = !!mine && (m.a === mine || m.b === mine);
    const canEnter = edit?.results && m.a && m.b && !r;
    return (
      <div key={m.id} className={`match ${cls === "over" ? "over" : ""} ${isMine ? "mine" : ""}`} data-mid={m.id} data-feeds={m.feeds}>
        <div className="match-head">
          <span>
            {m.id} · Bo{state.bestOf}
          </span>
          <span className={`st ${cls}`} title={due ? `Deadline ${formatWhen(due)}` : undefined}>
            {text}
          </span>
        </div>
        {row(m.a, m.sa, m.pa)}
        {row(m.b, m.sb, m.pb)}
        {canEnter && (
          <div className="match-foot">
            <a className="btn xs" href={`#result-${m.id}`}>
              Enter result
            </a>
          </div>
        )}
      </div>
    );
  };

  const crossTable = (teamIds: string[], slotIndexes?: number[]) => (
    <div className="tblwrap">
      <table className="xt">
        <thead>
          <tr>
            <th>Team</th>
            {teamIds.map((id) => (
              <th key={id} title={name(id) ?? id}>
                {(name(id) ?? id).slice(0, 3).toUpperCase()}
              </th>
            ))}
            <th>W–L</th>
          </tr>
        </thead>
        <tbody>
          {teamIds.map((row, ri) => {
            let w = 0;
            let l = 0;
            const cells = teamIds.map((col) => {
              if (row === col) return <td key={col} className="self">—</td>;
              const m = bracket.matches.find((x) => (x.a === row && x.b === col) || (x.a === col && x.b === row));
              const r = resultOf(state, m);
              if (r) {
                if (r.winner === row) w++;
                else l++;
              }
              return (
                <td key={col}>
                  {r ? (
                    r.winner === row ? (
                      <span className="w">W {r.by === "forfeit" ? "FF" : `${r.w}–${r.l}`}</span>
                    ) : (
                      <span className="l">L {r.by === "forfeit" ? "FF" : `${r.l}–${r.w}`}</span>
                    )
                  ) : (
                    <span className="muted">·</span>
                  )}
                </td>
              );
            });
            return (
              <tr key={row}>
                <td className="tcell">{teamChip(row, slotIndexes?.[ri])}</td>
                {cells}
                <td className="rec">
                  {w}–{l}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <BoardClient teams={hoverTeams(state, game, wins, phase)} swap={edit ? { tid: edit.tid, tab: edit.tab } : undefined}>
      <div className="board">
        {bracket.parts.map((part, i) => {
          if (part.kind === "bracket" || part.kind === "swiss") {
            const flat = part.kind === "swiss";
            return (
              <div key={i} className="bsec">
                {part.title && <h3 className="bsec-title">{part.title}</h3>}
                <div className={`bracket ${flat ? "flat" : ""}`}>
                  {!flat && <svg className="wires" aria-hidden="true" />}
                  {part.columns.map((c) => (
                    <div key={c.title} className="bcol">
                      <div className="bcol-title">{c.title}</div>
                      <div className="bcol-body">
                        {c.matches.map(matchCard)}
                        {c.note && <div className="note-card">{c.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          if (part.kind === "cross") {
            return (
              <div key={i} className="bsec">
                <h3 className="bsec-title">{part.title}</h3>
                {crossTable(part.teamIds)}
              </div>
            );
          }
          if (part.kind === "groups") {
            return (
              <div key={i} className="bsec">
                <h3 className="bsec-title">{part.title}</h3>
                <div className="groups">
                  {part.groups.map((g) => (
                    <div key={g.name} className="group">
                      <h4>{g.name}</h4>
                      {crossTable(g.teamIds, g.slotIndexes)}
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="bsec">
              <h3 className="bsec-title">{part.title}</h3>
              <ol className="lb card" style={{ padding: "4px 14px", maxWidth: 420 }}>
                {bracket.standings.map((s, j) => (
                  <li key={s.teamId}>
                    <span className="pos">{j + 1}</span>
                    <span className="who">{teamChip(s.teamId, undefined)}</span>
                    <span className="wins">
                      {s.wins}–{s.losses}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </BoardClient>
  );
}
