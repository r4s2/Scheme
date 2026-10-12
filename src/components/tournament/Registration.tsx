import { GAMES, rankShortName } from "@/engine";
import { hoverTeam } from "@/components/bracket/hover";
import { HoverLayer } from "@/components/bracket/HoverLayer";
import { CheckIcon, WarnIcon } from "@/components/ui/icons";
import { startText } from "@/lib/format";
import type { TournamentAgg } from "@/server/model";
import { Op } from "./Op";

/** While sign-ups are open: who's in, how many spots are left, and (for the host) opening check-in. */
export function Registration({ agg, now, isHost, wins }: { agg: TournamentAgg; now: Date; isHost: boolean; wins: Record<string, number> }) {
  const teams = Object.values(agg.state.teams);
  const solo = agg.signupType === "solo";
  const size = GAMES[agg.game].roles.length;
  const capacity = solo ? agg.teamCount * size : agg.teamCount;
  const registered = solo ? teams.reduce((n, t) => n + t.players.length, 0) + agg.pool.length : teams.length;
  const full = registered >= capacity;
  const pct = Math.min(100, (registered / capacity) * 100);
  const hover = Object.fromEntries(teams.map((t) => [t.id, hoverTeam(t, agg.game, wins[t.name.toLowerCase()] ?? 0, "registration")]));

  return (
    <>
      <div className={`banner ${full ? "gold" : "info"}`}>
        <div className="btext">
          <b>
            Registration is open · {registered} of {capacity} {solo ? "players" : "teams"}
          </b>
          <span className="small">
            {full ? "Full. " : `${capacity - registered} spot${capacity - registered === 1 ? "" : "s"} left. `}
            Starts {startText(agg.startsAt, now)}.{" "}
            {solo ? "When registration closes, Scheme balances everyone into teams of " + size + "." : "Captains register their whole team."}
          </span>
        </div>
        {isHost && (
          <Op tid={agg.id} op="openCheckin" tab="bracket">
            <button className="btn sm primary" disabled={!full || solo} title={solo ? "Solo events open check-in once the team balancer is built" : full ? undefined : "Opens when every spot is filled"}>
              Open check-in
            </button>
          </Op>
        )}
      </div>
      <div className="fill" style={{ marginBottom: 18 }} role="presentation">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="small muted" style={{ marginBottom: 14 }}>
        Signing up from Scheme arrives with accounts. For now, this shows who&apos;s registered.
      </p>

      {solo ? (
        <div className="card panel">
          <h3>Solo sign-ups</h3>
          <p className="lead">Verified ranks and preferred roles. The balancer uses these to build even teams.</p>
          <div className="tblwrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Role</th>
                  <th className="num">Rank</th>
                  <th className="num">Karma</th>
                </tr>
              </thead>
              <tbody>
                {agg.pool.map((p) => (
                  <tr key={p.handle}>
                    <td>{p.handle}</td>
                    <td className="muted">{p.role}</td>
                    <td className="num">
                      {rankShortName(agg.game, p.score)}{" "}
                      <span className={`vmark ${p.verified === "self" ? "self" : ""}`} title={p.verified === "self" ? "Self-reported rank" : "Verified rank"}>
                        {p.verified === "self" ? <WarnIcon /> : <CheckIcon />}
                      </span>
                    </td>
                    <td className="num">{p.karma ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <HoverLayer teams={hover}>
          <div className="reg-grid">
            {teams.map((t, i) => (
              <div key={t.id} className="card" style={{ padding: "10px 12px" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="team" data-team={t.id} tabIndex={0} style={{ flex: 1, cursor: "default" }}>
                    <span className="tn">
                      <b>{t.name}</b>
                    </span>
                    <span className="tr">{hover[t.id].avgRank}</span>
                  </span>
                  <span className="mono tiny muted">#{i + 1}</span>
                </div>
                <p className="tiny muted" style={{ padding: "0 6px" }}>
                  Captain {t.captain} · {t.players.length} players
                </p>
              </div>
            ))}
            {Array.from({ length: Math.max(0, capacity - teams.length) }, (_, i) => (
              <div key={`open-${i}`} className="card" style={{ padding: "10px 12px", borderStyle: "dashed", background: "none" }}>
                <span className="muted small">Open spot</span>
              </div>
            ))}
          </div>
        </HoverLayer>
      )}
    </>
  );
}
