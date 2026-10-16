import { averageScore, GAMES, rankName, rankShortName, resultOf, type Team } from "@/engine";
import type { TournamentAgg } from "@/server/model";
import { bracketOf } from "@/server/views";

/** The numbers every stats view shares, worked out once. */
function facts(agg: TournamentAgg) {
  const teams = agg.state.slots.map((id) => agg.state.teams[id]).filter((t): t is Team => !!t);
  const avgs = teams.map((t) => ({ t, a: averageScore(t) })).sort((x, y) => y.a - x.a);
  const field = avgs.length ? avgs.reduce((s, x) => s + x.a, 0) / avgs.length : 0;
  const players = teams.flatMap((t) => t.players.map((p) => ({ ...p, team: t })));
  const scores = players.map((p) => p.score).sort((a, b) => a - b);
  const b = agg.status === "registration" ? null : bracketOf(agg);
  const done = b ? b.matches.filter((m) => resultOf(agg.state, m)).length : 0;
  return { teams, avgs, field, players, scores, bracket: b, done };
}

/**
 * A slim line of the event's key numbers, for above the bracket board: size,
 * field strength, how even the teams are, check-in and match progress.
 */
export function StatStrip({ agg }: { agg: TournamentAgg }) {
  const g = agg.game;
  const f = facts(agg);
  if (!f.teams.length) return null;
  const spread = f.avgs[0].a - f.avgs[f.avgs.length - 1].a;
  const inCount = f.teams.filter((t) => !t.rejected && t.players.every((p) => p.checkedIn)).length;
  const rejected = f.teams.filter((t) => t.rejected).length;
  const items: [string, React.ReactNode][] = [
    ["Field", `${f.teams.length} teams · ${f.players.length} players`],
    ["Average rank", rankName(g, f.field)],
    ["Spread", `${spread.toFixed(1)} divisions`],
  ];
  if (agg.status === "checkin") items.push(["Checked in", `${inCount} of ${f.teams.length - rejected} teams${rejected ? ` · ${rejected} rejected` : ""}`]);
  if (f.bracket) items.push(["Matches", `${f.done} of ${f.bracket.matches.length} played`]);
  return (
    <dl className="statstrip" aria-label="Event at a glance">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Average rank by team and the spread of individual ranks. Folded away by default when it sits under the board. */
export function FieldBreakdown({ agg, folded = false }: { agg: TournamentAgg; folded?: boolean }) {
  const g = agg.game;
  const G = GAMES[g];
  const D = G.divisions.length;
  const f = facts(agg);
  if (!f.teams.length) return null;
  const lo = Math.floor(Math.min(...f.avgs.map((x) => x.a)) / D) * D;
  const hi = Math.ceil((Math.max(...f.avgs.map((x) => x.a)) + 0.5) / D) * D;
  const pct = (v: number) => ((v - lo) / Math.max(1, hi - lo)) * 100;
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += D) ticks.push(v);

  const body = (
    <div className="breakdown">
      <div>
        <h3>Average rank by team</h3>
        <p className="lead">{agg.signupType === "solo" ? "The balancer kept these close on purpose." : "Teams registered as rosters, so some spread is expected."}</p>
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
          {f.avgs.map((x) => (
            <span key={x.t.id} style={{ display: "contents" }}>
              <span className="nm">{x.t.name}</span>
              <div className="track" style={{ ["--step" as string]: `calc(100% / ${Math.max(1, (hi - lo) / D)})` }}>
                <i style={{ width: `${pct(x.a)}%` }} />
                <span className="avgline" style={{ left: `${pct(f.field)}%` }} />
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
            Field average ({rankName(g, f.field)})
          </span>
        </div>
      </div>
      <div>
        <h3>Rank spread</h3>
        <p className="lead">Individual ranks across every starter.</p>
        <dl className="kv">
          <dt>Highest</dt>
          <dd>{rankName(g, f.scores[f.scores.length - 1])}</dd>
          <dt>Lowest</dt>
          <dd>{rankName(g, f.scores[0])}</dd>
          <dt>Median</dt>
          <dd>{rankName(g, f.scores[Math.floor(f.scores.length / 2)])}</dd>
          <dt>Verified</dt>
          <dd>
            {f.players.filter((p) => p.verified === "api").length} of {f.players.length}
          </dd>
        </dl>
      </div>
    </div>
  );

  if (!folded) return <div className="card panel">{body}</div>;
  return (
    <details className="card panel fold">
      <summary>
        <b>Team strength</b>
        <span className="small muted">Average rank by team and the spread of individual ranks</span>
      </summary>
      {body}
    </details>
  );
}

/** The separate Stats tab, used when the bracket hub layout is off. */
export function Stats({ agg }: { agg: TournamentAgg }) {
  if (!agg.state.slots.length) return <div className="empty">Stats appear once teams are in.</div>;
  return (
    <>
      <StatStrip agg={agg} />
      <FieldBreakdown agg={agg} />
    </>
  );
}
