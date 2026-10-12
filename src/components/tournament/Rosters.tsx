import { rankShortName, type GameId, type Player, type Team } from "@/engine";
import { CheckIcon, WarnIcon } from "@/components/ui/icons";
import type { TournamentAgg } from "@/server/model";

function Line({ p, game, captain }: { p: Player; game: GameId; captain: string }) {
  return (
    <li>
      <span>
        <a href={`/u/${p.handle}`} style={{ color: "inherit" }}>
          {p.handle}
        </a>
        {p.handle === captain && <span className="tiny muted"> (c)</span>}
        {p.confirmation === "pending" && <span className="tiny picker-warn"> unconfirmed</span>}
        {p.confirmation === "declined" && <span className="tiny picker-bad"> can&apos;t play</span>}
      </span>
      <span className="tiny muted">{p.role}</span>
      <span className="mono tiny">
        {rankShortName(game, p.score)}{" "}
        <span className={`vmark ${p.verified === "self" ? "self" : ""}`} title={p.verified === "self" ? "Self-reported rank" : "Verified rank"}>
          {p.verified === "self" ? <WarnIcon /> : <CheckIcon />}
        </span>
      </span>
    </li>
  );
}

/** One team's registered roster: starters, then subs. */
export function RosterCard({ team, game, title }: { team: Team; game: GameId; title?: React.ReactNode }) {
  const bench = team.bench ?? [];
  return (
    <div className="card" style={{ padding: "12px 14px" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ fontSize: 15 }}>{title ?? team.name}</h3>
        <span className="tiny muted">
          {team.players.length} starters{bench.length ? ` · ${bench.length} sub${bench.length === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <ul className="roster-list">
        {team.players.map((p) => (
          <Line key={p.handle} p={p} game={game} captain={team.captain} />
        ))}
        {bench.length > 0 && <li className="sub-h">Subs</li>}
        {bench.map((p) => (
          <Line key={p.handle} p={p} game={game} captain={team.captain} />
        ))}
      </ul>
    </div>
  );
}

/** Every team's registered roster, for checking who played against a result screenshot. */
export function Rosters({ agg }: { agg: TournamentAgg }) {
  const teams = agg.state.slots.map((id) => agg.state.teams[id]).filter(Boolean);
  const rest = Object.values(agg.state.teams).filter((t) => !agg.state.slots.includes(t.id));
  return (
    <>
      <p className="small muted" style={{ marginBottom: 12 }}>
        Rosters as registered. Subs can play any role; check a result screenshot against the full roster.
      </p>
      <div className="roster-grid">
        {[...teams, ...rest].map((t) => (
          <RosterCard key={t.id} team={t} game={agg.game} />
        ))}
      </div>
    </>
  );
}
