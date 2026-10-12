import { formatWhen } from "@/lib/format";
import type { TournamentAgg } from "@/server/model";
import { Hidden, Op } from "./Op";

/** Announcements from the host. The host can post to everyone or just captains. */
export function Announcements({ agg, isHost }: { agg: TournamentAgg; isHost: boolean }) {
  const list = [...agg.announcements].reverse();
  return (
    <>
      {isHost && (
        <div className="card panel">
          <h3>Post an announcement</h3>
          <p className="lead">Shows here and in everyone&apos;s notifications. Discord posting arrives with the Scheme bot.</p>
          <Op tid={agg.id} op="announce" className="stack">
            <textarea name="body" rows={3} maxLength={1000} required placeholder="Round 2 starts Saturday at 8 PM ET. Lobby details are on your match page." />
            <div className="row">
              <label className="small" htmlFor="ann-audience">
                Send to
              </label>
              <select id="ann-audience" name="audience" defaultValue="all">
                <option value="all">Everyone in the event</option>
                <option value="captains">Captains only</option>
              </select>
              <button className="btn primary sm">Post</button>
            </div>
          </Op>
        </div>
      )}
      {list.length === 0 ? (
        <div className="empty">No announcements yet.</div>
      ) : (
        <div className="card">
          <ul className="log" style={{ padding: "4px 16px" }}>
            {list.map((a) => (
              <li key={a.id}>
                <span className="small muted">
                  {formatWhen(a.createdAt)}
                  <br />
                  {a.sentBy}
                  {a.audience === "captains" ? " · captains" : ""}
                </span>
                <span style={{ whiteSpace: "pre-wrap" }}>{a.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

const CATEGORY: Record<string, string> = { result: "Match result", player: "A player", rules: "Rules", schedule: "Schedule", other: "Something else" };
const STATUS: Record<string, [string, string]> = { open: ["warn", "Open"], answered: ["info", "Answered"], closed: ["quiet", "Closed"] };

/**
 * Help tickets. Players see their own and can open one; the host sees every
 * ticket and replies. Either side can close a ticket.
 */
export function Tickets({ agg, actor, isHost, open: openId }: { agg: TournamentAgg; actor: string | null; isHost: boolean; open?: string }) {
  const inEvent = !!actor && (Object.values(agg.state.teams).some((t) => t.players.some((p) => p.handle === actor)) || agg.subs.some((p) => p.handle === actor) || agg.pool.some((p) => p.handle === actor));
  const mine = isHost ? agg.tickets : agg.tickets.filter((k) => k.openedBy === actor);
  const sorted = [...mine].sort((a, b) => (a.status === "closed" ? 1 : 0) - (b.status === "closed" ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));
  const name = (id?: string) => (id ? agg.state.teams[id]?.name : undefined);
  return (
    <>
      {!isHost && inEvent && (
        <details className="card panel" open={mine.length === 0}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Open a ticket</summary>
          <p className="lead" style={{ marginTop: 8 }}>
            For anything the host needs to sort out: a wrong score, a no-show, a rules question.
          </p>
          <Op tid={agg.id} op="openTicket" className="stack">
            <div className="grid2">
              <label className="field">
                <span>About</span>
                <select name="category" defaultValue="result">
                  {Object.entries(CATEGORY).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>
                  Match <span className="help">optional</span>
                </span>
                <input name="matchId" placeholder="M4" maxLength={8} />
              </label>
            </div>
            <label className="field">
              <span>Subject</span>
              <input name="subject" required maxLength={120} />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea name="body" rows={3} required maxLength={2000} />
            </label>
            <div>
              <button className="btn primary sm">Send to host</button>
            </div>
          </Op>
        </details>
      )}
      {sorted.length === 0 ? (
        <div className="empty">{isHost ? "No tickets. Players can open one from this tab." : inEvent ? "You haven't opened any tickets." : "Tickets are for players in this event."}</div>
      ) : (
        sorted.map((k) => (
          <details key={k.id} className="card panel" open={k.id === openId || (k.status !== "closed" && sorted.length <= 3)}>
            <summary style={{ cursor: "pointer", listStyle: "none" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>{k.subject}</b>
                <span className={`pill ${STATUS[k.status][0]}`}>{STATUS[k.status][1]}</span>
              </div>
              <p className="small muted">
                {CATEGORY[k.category]} · {k.openedBy}
                {name(k.teamId) ? ` (${name(k.teamId)})` : ""}
                {k.matchId ? ` · ${k.matchId}` : ""} · {formatWhen(k.createdAt)}
              </p>
            </summary>
            <div className="thread">
              {k.messages.map((m) => (
                <div key={m.id} className={`bubble ${m.author === agg.host ? "host" : ""}`}>
                  <div className="who">
                    {m.author ?? "Scheme"}
                    {m.author === agg.host ? " · host" : ""} · {formatWhen(m.createdAt)}
                  </div>
                  <span style={{ whiteSpace: "pre-wrap" }}>{m.body}</span>
                </div>
              ))}
            </div>
            {k.status !== "closed" && (
              <div className="row" style={{ alignItems: "flex-start" }}>
                <Op tid={agg.id} op="replyTicket" className="row" >
                  <Hidden name="ticketId" value={k.id} />
                  <input name="body" required maxLength={2000} placeholder={isHost ? "Reply to the player" : "Add a reply"} style={{ minWidth: 260, flex: 1 }} aria-label="Reply" />
                  <button className="btn sm primary">Reply</button>
                </Op>
                <Op tid={agg.id} op="closeTicket">
                  <Hidden name="ticketId" value={k.id} />
                  <button className="btn sm">Close ticket</button>
                </Op>
              </div>
            )}
          </details>
        ))
      )}
    </>
  );
}
