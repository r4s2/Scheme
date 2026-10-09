import { averageScore, buildBracket, rankShortName, resultOf, type GameId, type Match, type TournamentState } from "@/engine";
import styles from "./BracketView.module.css";

/**
 * Read-only bracket. Renders every format the engine supports. Interactive
 * editing (drag to swap, randomize, seed, transform) comes next; see the
 * prototype for the intended behavior.
 */
export function BracketView({ state, game }: { state: TournamentState; game: GameId }) {
  const bracket = buildBracket(state);
  const name = (id: string | null) => (id ? state.teams[id]?.name ?? id : null);

  const matchCard = (m: Match) => {
    const r = resultOf(state, m);
    const row = (id: string | null, placeholder?: string) => {
      const won = r && r.winner === id;
      const score = r ? (r.by === "forfeit" ? (won ? "W" : "FF") : won ? r.w : r.l) : "";
      return (
        <div className={`${styles.slot} ${won ? styles.win : r ? styles.lose : ""}`}>
          <span className={styles.team}>{name(id) ?? <span className={styles.tbd}>{placeholder ?? "TBD"}</span>}</span>
          {id && <span className={styles.rank}>{rankShortName(game, averageScore(state.teams[id]))}</span>}
          <span className={styles.score}>{score}</span>
        </div>
      );
    };
    return (
      <div key={m.id} className={styles.match}>
        <div className={styles.matchHead}>
          <span>
            {m.id} · Bo{state.bestOf}
          </span>
          <span>{r ? "Final" : m.a && m.b ? "Open" : "Waiting"}</span>
        </div>
        {row(m.a, m.pa)}
        {row(m.b, m.pb)}
      </div>
    );
  };

  return (
    <div className={styles.board}>
      {bracket.parts.map((part, i) => {
        if (part.kind === "bracket" || part.kind === "swiss") {
          return (
            <section key={i} className={styles.section}>
              {part.title && <h3 className={styles.sectionTitle}>{part.title}</h3>}
              <div className={styles.columns}>
                {part.columns.map((c) => (
                  <div key={c.title} className={styles.column}>
                    <div className={styles.columnTitle}>{c.title}</div>
                    <div className={part.kind === "swiss" ? styles.columnTop : styles.columnBody}>
                      {c.matches.map(matchCard)}
                      {c.note && <p className={styles.note}>{c.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        }
        if (part.kind === "cross" || part.kind === "groups") {
          const groups = part.kind === "cross" ? [{ name: part.title, teamIds: part.teamIds }] : part.groups;
          return (
            <section key={i} className={styles.section}>
              {part.kind === "groups" && <h3 className={styles.sectionTitle}>{part.title}</h3>}
              <div className={styles.groups}>
                {groups.map((g) => (
                  <table key={g.name} className={styles.table}>
                    <caption>{g.name}</caption>
                    <thead>
                      <tr>
                        <th>Team</th>
                        {g.teamIds.map((id) => (
                          <th key={id} title={name(id) ?? id}>
                            {(name(id) ?? id).slice(0, 3)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.teamIds.map((row) => (
                        <tr key={row}>
                          <td>{name(row)}</td>
                          {g.teamIds.map((col) => {
                            if (row === col) return <td key={col}>—</td>;
                            const m = bracket.matches.find((x) => (x.a === row && x.b === col) || (x.a === col && x.b === row));
                            const r = resultOf(state, m);
                            return <td key={col}>{r ? (r.winner === row ? `W ${r.w}–${r.l}` : `L ${r.l}–${r.w}`) : "·"}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </div>
            </section>
          );
        }
        return (
          <section key={i} className={styles.section}>
            <h3 className={styles.sectionTitle}>{part.title}</h3>
            <ol className={styles.standings}>
              {bracket.standings.map((s) => (
                <li key={s.teamId}>
                  {name(s.teamId)} <span className={styles.rank}>{s.wins}–{s.losses}</span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
