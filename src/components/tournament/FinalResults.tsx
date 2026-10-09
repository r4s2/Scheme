import { formatCents } from "@/engine";
import { formatWhen } from "@/lib/format";
import type { TournamentAgg } from "@/server/model";
import ui from "../ui.module.css";

const PLACE = ["1st", "2nd", "3rd"];

export function FinalResults({ agg }: { agg: TournamentAgg }) {
  if (agg.status === "cancelled") {
    return (
      <div className={`${ui.card} ${ui.cardAlert}`}>
        <h3>This tournament was cancelled</h3>
        <p className={ui.small}>{agg.cancelReason}</p>
      </div>
    );
  }
  const c = agg.closure;
  if (!c) return null;
  const name = (id: string) => agg.state.teams[id]?.name ?? id;
  const teamCents = (id: string) => agg.payouts.filter((p) => p.teamId === id).reduce((s, p) => s + p.cents, 0);
  return (
    <div className={`${ui.card} ${ui.cardGold}`}>
      <h3>Final results</h3>
      <p className={`${ui.small} ${ui.muted}`}>
        Closed {formatWhen(c.at)} ·{" "}
        {c.method === "bracket" ? "decided by the bracket" : c.method === "standings" ? "decided by current standings" : "winners chosen by the host"}
      </p>
      <table className={ui.table}>
        <thead>
          <tr>
            <th>Place</th>
            <th>Team</th>
            {agg.payouts.length > 0 && <th>Prize</th>}
          </tr>
        </thead>
        <tbody>
          {c.places.flatMap((teams, i) =>
            teams.map((t) => (
              <tr key={t}>
                <td className={ui.mono}>{i === 0 && teams.length > 1 ? "1st (shared)" : PLACE[i]}</td>
                <td>{name(t)}</td>
                {agg.payouts.length > 0 && <td className={ui.mono}>{teamCents(t) ? formatCents(teamCents(t)) : "—"}</td>}
              </tr>
            )),
          )}
        </tbody>
      </table>
      {c.prize && (
        <p className={ui.small} style={{ marginTop: 10 }}>
          <b>Prize for the winners:</b> {c.prize.name}. Claim details went to the winners.
        </p>
      )}
      <p className={`${ui.small} ${ui.muted}`} style={{ marginTop: 8 }}>
        Message to everyone: “{c.message}”
      </p>
    </div>
  );
}
