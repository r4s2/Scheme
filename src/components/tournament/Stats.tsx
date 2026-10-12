import { averageScore, GAMES, rankName, rankShortName, resultOf } from "@/engine";
import type { TournamentAgg } from "@/server/model";
import { bracketOf } from "@/server/views";

/** The prototype's stats tab: field strength, balance between teams, role coverage and every player. */
export function Stats({ agg }: { agg: TournamentAgg }) {
  const g = agg.game;
  const G = GAMES[g];
  const D = G.divisions.length;
  const teams = agg.state.slots.map((id) => agg.state.teams[id]).filter(Boolean);
  if (!teams.length) return <div className="empty">Stats appear once teams are in.</div>;
  const avgs = teams.map((t) => ({ t, a: averageScore(t) })).sort((x, y) => y.a - x.a);
  const field = avgs.reduce((s, x) => s + x.a, 0) / avgs.length;
  const lo = Math.floor(Math.min(...avgs.map((x) => x.a)) / D) * D;
  const hi = Math.ceil((Math.max(...avgs.map((x) => x.a)) + 0.5) / D) * D;
  const pct = (v: number) => ((v - lo) / Math.max(1, hi - lo)) * 100;
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += D) ticks.push(v);
  const players = teams.flatMap((t) => t.players.map((p) => ({ ...p, team: t })));
  const scores = players.map((p) => p.score).sort((a, b) => a - b);
  const b = agg.status === "registration" ? null : bracketOf(agg);
  const done = b ? b.matches.filter((m) => resultOf(agg.state, m)).length : 0;
  const need: Record<string, number> = {};
  for (const r of agg.roles) need[r] = (need[r] ?? 0) + 1;
  const roleSet = Object.keys(need);

  return (
    <>
      <div className="kpis">
        <div className="card kpi">
          <b>{teams.length}</b>
          <span>teams · {players.length} players</span>
        </div>
        <div className="card kpi">
          <b>{rankShortName(g, field)}</b>
          <span>field average rank</span>
        </div>
        <div className="card kpi">
          <b>{(avgs[0].a - avgs[avgs.length - 1].a).toFixed(1)}</b>
          <span>divisions between top and bottom team</span>
        </div>
        <div className="card kpi">
          <b>
            {teams.filter((t) => t.players.every((p) => p.checkedIn)).length}/{teams.length}
          </b>
          <span>teams fully checked in</span>
        </div>
        {b && (
          <div className="card kpi">
            <b>
              {done}/{b.matches.length}
            </b>
            <span>matches complete</span>
          </div>
        )}
      </div>

      <div className="card panel">
        <h3>Average rank by team</h3>
        <p className="lead">Mean verified rank of each roster. {agg.signupType === "solo" ? "The balancer kept these close on purpose." : "Rosters were registered as teams, so spread is expected."}</p>
        <div className="bars">
          <span />
          <div className="axis">
            {ticks.map((v) => (
              <span key={v} style={{ left: `${pct(v)}%` }}>
                {G.tiers[Math.min(v / D, G.tiers.length - 1)]}
              </span>
            ))}
          </div>
          <span />
          {avgs.map((x) => (
            <span key={x.t.id} style={{ display: "contents" }}>
              <span className="nm">{x.t.name}</span>
              <div className="track" style={{ ["--step" as string]: `calc(100% / ${Math.max(1, (hi - lo) / D)})` }}>
                <i style={{ width: `${pct(x.a)}%` }} />
                <span className="avgline" style={{ left: `${pct(field)}%` }} />
              </div>
              <span className="val">{rankShortName(g, x.a)}</span>
            </span>
          ))}
        </div>
        <div className="legend">
          <span>
            <em />
            Team average
          </span>
          <span>
            <i />
            Field average ({rankName(g, field)})
          </span>
          <span>Gridlines mark each rank tier.</span>
        </div>
      </div>

      <div className="two">
        <div className="card panel">
          <h3>Role coverage</h3>
          <p className="lead">Players on each roster per required role.</p>
          <div className="tblwrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Team</th>
                  {roleSet.map((r) => (
                    <th key={r} className="num">
                      {r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    {roleSet.map((r) => {
                      const c = t.players.filter((p) => p.role === r).length;
                      return (
                        <td key={r} className={`num ${c >= need[r] ? "role-ok" : "role-short"}`}>
                          {c}/{need[r]}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card panel">
          <h3>Rank spread</h3>
          <p className="lead">Range of individual ranks in the event.</p>
          <dl className="kv">
            <dt>Highest</dt>
            <dd>{rankName(g, scores[scores.length - 1])}</dd>
            <dt>Lowest</dt>
            <dd>{rankName(g, scores[0])}</dd>
            <dt>Median</dt>
            <dd>{rankName(g, scores[Math.floor(scores.length / 2)])}</dd>
            <dt>Verified</dt>
            <dd>
              {players.filter((p) => p.verified === "api").length} by API · {players.filter((p) => p.verified === "self").length} self-reported
            </dd>
          </dl>
        </div>
      </div>

      <div className="card panel">
        <h3>Players</h3>
        <div className="tblwrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th>Team</th>
                <th>Role</th>
                <th>Rank</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={`${p.team.id}-${p.handle}`}>
                  <td>
                    <a href={`/u/${p.handle}`} style={{ color: "inherit" }}>
                      {p.handle}
                    </a>
                    {p.team.captain === p.handle && <span className="pill quiet"> Captain</span>}
                  </td>
                  <td>{p.team.name}</td>
                  <td>{p.role}</td>
                  <td className="mono">{rankName(g, p.score)}</td>
                  <td>{p.verified === "api" ? <span className="pill good">Verified</span> : <span className="pill warn">Self-reported</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
