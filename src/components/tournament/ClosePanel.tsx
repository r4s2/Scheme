import { allocatePrizes, finalPlaces, formatCents, prizePoolCents } from "@/engine";
import type { TournamentAgg } from "@/server/model";
import { bracketOf } from "@/server/views";
import ui from "../ui.module.css";
import { Op } from "./Op";

/** Closing or cancelling a live event. `bare` drops the card and title, for use inside the desk. */
export function ClosePanel({ agg, bare = false }: { agg: TournamentAgg; bare?: boolean }) {
  if (agg.status !== "live") {
    return <p className={ui.muted}>{agg.status === "complete" ? "This tournament is already closed." : "Start the tournament before closing it."}</p>;
  }
  const tid = agg.id;
  const b = bracketOf(agg);
  const name = (id: string) => agg.state.teams[id]?.name ?? id;
  const pool = agg.entryFeeCents > 0 ? prizePoolCents(agg.entryFeeCents, agg.state.slots.length, agg.withholdPct) : 0;
  const preview = finalPlaces(b, { method: b.complete ? "bracket" : "standings" });
  const prizes = pool ? allocatePrizes(pool, agg.payoutSplit, preview.places) : [];
  const defaultMessage = `${agg.name} is closed. Congratulations to ${preview.places[0].map(name).join(" and ")}! Thanks to all ${agg.state.slots.length} teams for playing.`;

  return (
    <div className={bare ? undefined : ui.card}>
      {!bare && <h3>Close {agg.name}</h3>}
      <p className={ui.lead}>Closing locks results, credits leaderboard wins, sends everyone your message, and starts the 24-hour payout window.</p>
      <Op tid={tid} op="close" tab="bracket" className={ui.stack}>
        {b.complete ? (
          <>
            <input type="hidden" name="method" value="bracket" />
            <p className={ui.small}>
              <span className={`${ui.pill} ${ui.pillGood}`}>Decided</span> {name(b.champion!)} won the bracket.
            </p>
          </>
        ) : (
          <fieldset className={ui.stack} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className={ui.field}>The bracket has no winner yet. How should it end?</legend>
            <label className={ui.check}>
              <input type="radio" name="method" value="standings" defaultChecked /> Use current standings ({b.standings.slice(0, 3).map((s, i) => `${i + 1}. ${name(s.teamId)}`).join(", ")})
            </label>
            <label className={ui.check}>
              <input type="radio" name="method" value="pick" /> Pick the winner:
              <select name="pick" aria-label="Winner">
                {b.standings.map((s) => (
                  <option key={s.teamId} value={s.teamId}>
                    {name(s.teamId)}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <label className={ui.check}>
                <input type="radio" name="method" value="co_winners" /> Pick co-winners (they share first place and its prize):
              </label>
              <div className={ui.row} style={{ paddingLeft: 26, marginTop: 6 }}>
                {b.standings.map((s) => (
                  <label key={s.teamId} className={ui.check}>
                    <input type="checkbox" name="coWinners" value={s.teamId} /> {name(s.teamId)}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
        )}

        {pool > 0 && (
          <p className={ui.small}>
            Prize pool {formatCents(pool)}, split {agg.payoutSplit.join("/")}%.{" "}
            {b.complete ? "Payouts" : "With current standings, payouts"}: {prizes.map((p) => `${name(p.teamId)} ${formatCents(p.cents)}`).join(" · ")}. Each player claims their own share.
          </p>
        )}

        <label className={ui.check}>
          <input type="checkbox" name="prizeOn" /> Add a prize that isn&apos;t cash (gear, a gift card, something handed over in person)
        </label>
        <div className={ui.grid2}>
          <label className={ui.field}>
            Prize name
            <input name="prizeName" placeholder="Signed team jersey" />
          </label>
          <label className={ui.field}>
            How winners claim it <span className={ui.help}>Sent only to the winners.</span>
            <input name="prizeClaim" placeholder="Reply with a shipping address by Oct 16." />
          </label>
        </div>
        <label className={ui.field}>
          Message to everyone
          <textarea name="message" rows={3} defaultValue={defaultMessage} />
        </label>
        <div>
          <button className={`${ui.btn} ${ui.gold}`}>Close tournament and notify everyone</button>
        </div>
      </Op>

      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />
      <h3>Cancel instead</h3>
      <p className={ui.lead}>Ends the event without winners.{agg.entryFeeCents ? " Entry fees are refunded automatically." : ""} Cancelling lowers host karma unless the reason is outside your control.</p>
      <Op tid={tid} op="cancel" tab="bracket" className={ui.stack}>
        <label className={ui.field}>
          Reason <span className={ui.help}>Sent to every player.</span>
          <input name="reason" required placeholder="Not enough teams checked in." />
        </label>
        <div>
          <button className={`${ui.btn} ${ui.danger}`}>Cancel tournament</button>
        </div>
      </Op>
    </div>
  );
}
