import { OperationError, type Ctx, type Outcome, type Ticket, type TournamentAgg } from "./model";
import { audit, begin, done, everyone, notify, requireHost, rosterTeamOf, teamName } from "./operations";

/** Announcements from the host, and help tickets between players and the host. */

const clean = (s: string) => s.trim().replace(/\r\n/g, "\n");

export function postAnnouncement(agg: TournamentAgg, ctx: Ctx, body: string, audience: "all" | "captains"): Outcome {
  requireHost(agg, ctx);
  const text = clean(body);
  if (!text) throw new OperationError("Write the announcement first.");
  if (text.length > 1000) throw new OperationError("Keep announcements under 1,000 characters.");
  const { next, effects } = begin(agg);
  next.announcements = [...agg.announcements, { id: ctx.newId(), audience, body: text, sentBy: ctx.actor, createdAt: ctx.now.toISOString() }];
  const teams = Object.values(agg.state.teams);
  const recipients = audience === "captains" ? teams.map((t) => t.captain) : [...everyone(agg), ...agg.subs.map((p) => p.handle), ...agg.pool.map((p) => p.handle)];
  notify(effects, next, recipients, "announcement", `${agg.name}: ${text.length > 140 ? `${text.slice(0, 137)}…` : text}`);
  audit(effects, ctx, "announcement.post", `Posted an announcement to ${audience === "captains" ? "captains" : "everyone"}.`);
  return done(next, effects, `Sent to ${audience === "captains" ? `${teams.length} captains` : "everyone in the event"}.`);
}

const CATEGORIES: Ticket["category"][] = ["result", "player", "rules", "schedule", "other"];

export function openTicket(agg: TournamentAgg, ctx: Ctx, input: { category: string; subject: string; body: string; matchId?: string }): Outcome {
  const teamId = rosterTeamOf(agg, ctx.actor) ?? undefined;
  const inEvent = !!teamId || agg.subs.some((p) => p.handle === ctx.actor) || agg.pool.some((p) => p.handle === ctx.actor);
  if (!inEvent) throw new OperationError("Only players in this event can open a ticket.", "forbidden");
  if (!CATEGORIES.includes(input.category as Ticket["category"])) throw new OperationError("Pick what the ticket is about.");
  const subject = clean(input.subject);
  const body = clean(input.body);
  if (!subject || !body) throw new OperationError("Add a subject and a message.");
  if (subject.length > 120 || body.length > 2000) throw new OperationError("That's too long. Keep the subject under 120 characters and the message under 2,000.");
  const { next, effects } = begin(agg);
  const id = ctx.newId();
  const at = ctx.now.toISOString();
  next.tickets = [
    ...agg.tickets,
    { id, openedBy: ctx.actor, teamId, matchId: input.matchId || undefined, category: input.category as Ticket["category"], subject, status: "open", createdAt: at, messages: [{ id: ctx.newId(), author: ctx.actor, body, createdAt: at }] },
  ];
  notify(effects, next, [agg.host], "ticket", `New ticket in ${agg.name} from ${ctx.actor}${teamId ? ` (${teamName(agg, teamId)})` : ""}: ${subject}`);
  audit(effects, ctx, "ticket.open", `Opened a ticket: ${subject}`);
  return done(next, effects, "Ticket sent. The host will reply here and you'll get a notification.");
}

function ticketFor(agg: TournamentAgg, ctx: Ctx, ticketId: string): Ticket {
  const t = agg.tickets.find((x) => x.id === ticketId);
  if (!t) throw new OperationError("That ticket doesn't exist.", "not_found");
  if (ctx.actor !== agg.host && ctx.actor !== t.openedBy) throw new OperationError("Only the host and the player who opened it can see this ticket.", "forbidden");
  return t;
}

export function replyTicket(agg: TournamentAgg, ctx: Ctx, ticketId: string, body: string): Outcome {
  const t = ticketFor(agg, ctx, ticketId);
  const text = clean(body);
  if (!text) throw new OperationError("Write a reply first.");
  if (text.length > 2000) throw new OperationError("Keep replies under 2,000 characters.");
  const fromHost = ctx.actor === agg.host;
  const { next, effects } = begin(agg);
  next.tickets = agg.tickets.map((x) =>
    x.id === ticketId ? { ...x, status: fromHost ? "answered" : "open", messages: [...x.messages, { id: ctx.newId(), author: ctx.actor, body: text, createdAt: ctx.now.toISOString() }] } : x,
  );
  notify(effects, next, [fromHost ? t.openedBy : agg.host], "ticket", `${ctx.actor} replied to "${t.subject}" in ${agg.name}.`);
  audit(effects, ctx, "ticket.reply", `Replied to a ticket: ${t.subject}`);
  return done(next, effects, "Reply sent.");
}

export function closeTicket(agg: TournamentAgg, ctx: Ctx, ticketId: string): Outcome {
  const t = ticketFor(agg, ctx, ticketId);
  if (t.status === "closed") throw new OperationError("That ticket is already closed.", "conflict");
  const { next, effects } = begin(agg);
  next.tickets = agg.tickets.map((x) => (x.id === ticketId ? { ...x, status: "closed" } : x));
  if (ctx.actor === agg.host) notify(effects, next, [t.openedBy], "ticket", `The host closed your ticket "${t.subject}" in ${agg.name}.`);
  audit(effects, ctx, "ticket.close", `Closed a ticket: ${t.subject}`);
  return done(next, effects, "Ticket closed.");
}
