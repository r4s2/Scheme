import { formatWhen } from "@/lib/format";
import type { TournamentAgg } from "@/server/model";
import { bracketOf, deskItems } from "@/server/views";
import { ClosePanel } from "./ClosePanel";
import { AnnounceForm, AnnouncementList, TicketItem } from "./Community";
import { Desk } from "./Desk";

/** Whether the bracket has a champion and the event is waiting to be closed. */
export function readyToClose(agg: TournamentAgg): boolean {
  return agg.status === "live" && bracketOf(agg).complete;
}

/** How many things on the hub need the host: the match queue, open tickets, and a decided bracket to close. */
export function deskHubCount(agg: TournamentAgg, now: Date): number {
  const queue = agg.status === "live" ? deskItems(agg, now).count : 0;
  return queue + agg.tickets.filter((k) => k.status === "open").length + (readyToClose(agg) ? 1 : 0);
}

/**
 * The host's desk, in one place: what needs attention during play on the
 * left; announcements and tickets in a rail on the right; closing the event
 * folded away at the bottom until the bracket is decided, when it moves to
 * the top of the queue.
 */
export function DeskHub({ agg, now }: { agg: TournamentAgg; now: Date }) {
  const live = agg.status === "live";
  const decided = readyToClose(agg);
  const open = agg.tickets.filter((k) => k.status === "open").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rest = agg.tickets.filter((k) => k.status !== "open").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sent = agg.announcements.length;
  const last = agg.announcements.at(-1);
  const champion = decided ? agg.state.teams[bracketOf(agg).champion!]?.name : null;

  const close = live && (
    <details className={`card panel fold desk-close ${decided ? "is-ready" : ""}`} open={decided}>
      <summary>
        <b>{decided ? `${champion} won the bracket. Close the event` : "Close or cancel the event"}</b>
        <span className="small muted">{decided ? "Locks results, credits wins, and starts payouts." : "End it early with standings, a pick, or co-winners; or cancel."}</span>
      </summary>
      <ClosePanel agg={agg} bare />
    </details>
  );

  return (
    <div className="desk-hub">
      <div className="desk-main">
        <h2 className="desk-h">Needs you</h2>
        {decided && close}
        {live ? (
          <Desk agg={agg} now={now} hideEmpty />
        ) : (
          <div className="desk-clear">
            <b>{agg.status === "complete" ? "This event is closed." : agg.status === "cancelled" ? "This event was cancelled." : "Play hasn't started."}</b>
            {(agg.status === "registration" || agg.status === "checkin") && (
              <span className="small muted">Disputes, results waiting on a captain, extension requests and overdue matches show up here once it does.</span>
            )}
          </div>
        )}
        {!decided && close}
      </div>

      <aside className="desk-rail" aria-label="Announcements and tickets">
        <section className="card widget">
          <header>
            <h3>Tickets</h3>
            <span className={`pill ${open.length ? "warn" : "quiet"}`}>{open.length} open</span>
          </header>
          {open.length === 0 && <p className="small muted">No open tickets. Players open them from their Tickets tab.</p>}
          <div className="widget-list">
            {open.map((k) => (
              <TicketItem key={k.id} agg={agg} ticket={k} isHost compact open={open.length === 1} />
            ))}
          </div>
          {rest.length > 0 && (
            <details className="widget-more">
              <summary>
                {rest.length} answered or closed
              </summary>
              <div className="widget-list">
                {rest.map((k) => (
                  <TicketItem key={k.id} agg={agg} ticket={k} isHost compact />
                ))}
              </div>
            </details>
          )}
        </section>

        <section className="card widget">
          <header>
            <h3>Announcements</h3>
            <span className="small muted">{sent ? `${sent} sent · last ${formatWhen(last!.createdAt)}` : "None yet"}</span>
          </header>
          <AnnounceForm agg={agg} compact />
          {sent > 0 && (
            <details className="widget-more">
              <summary>{sent === 1 ? "Show the announcement" : `Show all ${sent}`}</summary>
              <AnnouncementList agg={agg} />
            </details>
          )}
        </section>
      </aside>
    </div>
  );
}
