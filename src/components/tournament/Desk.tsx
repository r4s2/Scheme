import { formatWhen, hoursText, possessive } from "@/lib/format";
import type { TournamentAgg } from "@/server/model";
import { deadlineOf, deskItems } from "@/server/views";
import ui from "../ui.module.css";
import { Hidden, Op } from "./Op";

/**
 * What needs the host during play: disputes, results waiting on the other
 * captain, extension requests and overdue matches. With `hideEmpty`, only
 * sections with something in them show, and an empty desk says so once.
 */
export function Desk({ agg, now, hideEmpty = false }: { agg: TournamentAgg; now: Date; hideEmpty?: boolean }) {
  if (agg.status !== "live") {
    return <p className={ui.muted}>The match desk fills up once the tournament starts: disputes, results waiting on confirmation, extension requests and overdue matches.</p>;
  }
  const d = deskItems(agg, now);
  if (hideEmpty && d.count === 0) {
    return (
      <div className="desk-clear">
        <b>Nothing needs you right now.</b>
        <span className="small muted">Disputes, results waiting on a captain, extension requests and overdue matches show up here.</span>
      </div>
    );
  }
  const tid = agg.id;
  const tab = "desk";
  const name = (id: string | null | undefined) => (id ? agg.state.teams[id]?.name ?? id : "TBD");
  const Section = ({ title, n, children, empty }: { title: string; n: number; children: React.ReactNode; empty: string }) =>
    hideEmpty && !n ? null : (
    <section className={ui.section}>
      <h2 className={ui.sectionTitle}>
        {title} <span className={`${ui.pill} ${n ? ui.pillWarn : ""}`}>{n}</span>
      </h2>
      {n ? children : <p className={`${ui.small} ${ui.muted}`}>{empty}</p>}
    </section>
  );

  return (
    <>
      <Section title="Disputes" n={d.disputes.length} empty="No disputes.">
        {d.disputes.map(({ dispute, match, reports }) => (
          <div key={dispute.id} className={`${ui.card} ${ui.cardAlert}`}>
            <h3>
              {match.id} · {name(match.a)} vs {name(match.b)}
            </h3>
            <div className={ui.reports}>
              {reports.map((r) => (
                <div key={r.id}>
                  <b>{name(r.teamId)}</b> reported
                  <br />
                  {name(r.winner)} won {r.w}–{r.l}
                  <br />
                  <span className={ui.muted}>by {r.reporter}</span>
                </div>
              ))}
            </div>
            <div className={ui.row}>
              {reports.map((r) => (
                <Op key={r.id} tid={tid} op="resolveDispute" tab={tab}>
                  <Hidden name="disputeId" value={dispute.id} />
                  <Hidden name="teamId" value={r.teamId} />
                  <button className={`${ui.btn} ${ui.primary}`}>Accept {possessive(name(r.teamId))} report</button>
                </Op>
              ))}
              <Op tid={tid} op="replay" tab={tab}>
                <Hidden name="disputeId" value={dispute.id} />
                <button className={ui.btn}>Order a replay</button>
              </Op>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Waiting on the other captain" n={d.awaitingConfirm.length} empty="No results waiting.">
        {d.awaitingConfirm.map(({ match, report }) => (
          <div key={report.id} className={ui.card}>
            <h3>
              {match.id} · {name(match.a)} vs {name(match.b)}
            </h3>
            <p className={ui.small}>
              {name(report.teamId)} reported {name(report.winner)} won {report.w}–{report.l}. It confirms automatically at {formatWhen(new Date(Date.parse(report.createdAt) + 12 * 3_600_000))}.
            </p>
            <Op tid={tid} op="confirmReport" tab={tab}>
              <Hidden name="reportId" value={report.id} />
              <button className={`${ui.btn} ${ui.primary}`}>Confirm now</button>
            </Op>
          </div>
        ))}
      </Section>

      <Section title="Extension requests" n={d.extensions.length} empty={agg.allowExtensions ? "No pending requests." : "Extensions are off for this event."}>
        {d.extensions.map(({ request, match }) => {
          const dl = match ? deadlineOf(agg, match) : null;
          return (
            <div key={request.id} className={ui.card}>
              <h3>
                {name(request.teamId)} wants {request.hours} more hour{request.hours === 1 ? "" : "s"} on {request.matchId}
              </h3>
              {request.reason && <p className={ui.small}>“{request.reason}”</p>}
              {dl && (
                <p className={`${ui.small} ${ui.muted}`}>
                  Due {formatWhen(dl)}. If approved: {formatWhen(new Date(dl.getTime() + request.hours * 3_600_000))}.
                </p>
              )}
              <div className={ui.row} style={{ marginTop: 8 }}>
                <Op tid={tid} op="decideExtension" tab={tab}>
                  <Hidden name="requestId" value={request.id} />
                  <Hidden name="decision" value="approve" />
                  <button className={`${ui.btn} ${ui.primary}`}>Approve</button>
                </Op>
                <Op tid={tid} op="decideExtension" tab={tab}>
                  <Hidden name="requestId" value={request.id} />
                  <Hidden name="decision" value="decline" />
                  <button className={ui.btn}>Decline</button>
                </Op>
              </div>
            </div>
          );
        })}
      </Section>

      <Section title="Overdue matches" n={d.overdue.length} empty="Nothing overdue.">
        {d.overdue.map(({ match, hoursOver }) => (
          <div key={match.id} className={ui.card}>
            <h3>
              {match.id} · {name(match.a)} vs {name(match.b)} <span className={`${ui.pill} ${ui.pillBad}`}>{hoursText(hoursOver)} overdue</span>
            </h3>
            <div className={ui.row} style={{ marginTop: 8 }}>
              <Op tid={tid} op="extend" tab={tab}>
                <Hidden name="matchId" value={match.id} />
                <Hidden name="hours" value={6} />
                <button className={ui.btn}>Extend 6 hours</button>
              </Op>
              {[match.a!, match.b!].map((w) => (
                <Op key={w} tid={tid} op="forfeit" tab={tab}>
                  <Hidden name="matchId" value={match.id} />
                  <Hidden name="winner" value={w} />
                  <button className={`${ui.btn} ${ui.danger}`}>Forfeit win to {name(w)}</button>
                </Op>
              ))}
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}
