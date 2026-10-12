import {
  allocatePrizes,
  autoConfirmAt,
  buildBracket,
  canTransform,
  lockedSlots,
  EngineError,
  evaluateReports,
  extendDeadline,
  finalPlaces,
  findMatch,
  formatCents,
  makeSchedule,
  payoutReleaseAt,
  playerShares,
  prizePoolCents,
  randomizeSlots,
  recordResult,
  reopenResult,
  resultOf,
  seedSlots,
  swapSlots,
  FORMAT_NAMES,
  type CloseInput,
  type FormatId,
  type Match,
  type ResultSource,
  type TournamentState,
} from "@/engine";
import { possessive } from "@/lib/format";
import { OperationError, type Ctx, type Effects, type Notice, type Outcome, type TournamentAgg } from "./model";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const HOUR = 3_600_000;

function begin(agg: TournamentAgg) {
  const effects: Effects = { audit: [], notices: [] };
  // Shallow copies; every operation replaces the parts it changes.
  const next: TournamentAgg = {
    ...agg,
    reports: [...agg.reports],
    disputes: [...agg.disputes],
    extensions: [...agg.extensions],
    payouts: [...agg.payouts],
    subs: [...agg.subs],
    pool: [...agg.pool],
    announcements: [...agg.announcements],
    tickets: [...agg.tickets],
  };
  return { next, effects };
}

function audit(effects: Effects, ctx: Ctx, action: string, summary: string) {
  effects.audit.push({ at: ctx.now.toISOString(), actor: ctx.actor, viaAgent: !!ctx.viaAgent, action, summary });
}

function link(agg: TournamentAgg) {
  return `/t/${agg.id}`;
}

function notify(effects: Effects, agg: TournamentAgg, recipients: Iterable<string>, kind: string, body: string) {
  const seen = new Set<string>();
  for (const r of recipients) {
    if (!r || seen.has(r)) continue;
    seen.add(r);
    effects.notices.push({ recipient: r, kind, body, link: link(agg) } satisfies Notice);
  }
}

const teamName = (agg: TournamentAgg, id: string | null) => (id ? agg.state.teams[id]?.name ?? id : "TBD");
const captainsOf = (agg: TournamentAgg, ...teamIds: (string | null)[]) =>
  teamIds.filter((t): t is string => !!t).map((t) => agg.state.teams[t]?.captain ?? "");
/** Everyone on a team, subs included. */
const everyone = (agg: TournamentAgg) => Object.values(agg.state.teams).flatMap((t) => [...t.players, ...(t.bench ?? [])].map((p) => p.handle));
const starters = (agg: TournamentAgg) => Object.values(agg.state.teams).flatMap((t) => t.players.map((p) => p.handle));

function requireHost(agg: TournamentAgg, ctx: Ctx) {
  if (ctx.actor !== agg.host) throw new OperationError("Only the host can do that.", "forbidden");
}

function requireOpen(agg: TournamentAgg) {
  if (agg.status === "complete" || agg.status === "cancelled") {
    throw new OperationError("This tournament is finished, so it can't change.", "conflict");
  }
}

function requireLive(agg: TournamentAgg) {
  if (agg.status !== "live") throw new OperationError("The tournament hasn't started yet.", "conflict");
}

function requireMatch(agg: TournamentAgg, matchId: string): Match {
  const m = findMatch(buildBracket(agg.state), matchId);
  if (!m) throw new OperationError(`Match ${matchId} doesn't exist.`, "not_found");
  if (!m.a || !m.b) throw new OperationError(`${matchId} doesn't have both teams yet.`, "conflict");
  return m;
}

/** The team a handle captains, if any. */
export function captainOf(agg: TournamentAgg, handle: string): string | null {
  return Object.values(agg.state.teams).find((t) => t.captain === handle)?.id ?? null;
}

/** The team a handle is registered with, as a starter or a sub. */
export function rosterTeamOf(agg: TournamentAgg, handle: string): string | null {
  return Object.values(agg.state.teams).find((t) => [...t.players, ...(t.bench ?? [])].some((p) => p.handle === handle))?.id ?? null;
}

/** The team a handle plays on (as a starter), if any. */
export function teamOf(agg: TournamentAgg, handle: string): string | null {
  return Object.values(agg.state.teams).find((t) => t.players.some((p) => p.handle === handle))?.id ?? null;
}

function wrapEngine<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof EngineError) throw new OperationError(e.message, "conflict");
    throw e;
  }
}

/** Apply a result and its side effects (disputes resolved, reports cleared, champion notice). */
function applyResult(
  agg: TournamentAgg,
  effects: Effects,
  ctx: Ctx,
  m: Match,
  winner: string,
  w: number,
  l: number,
  by: ResultSource,
) {
  const { state, championDecided } = wrapEngine(() => recordResult(agg.state, m.id, winner, w, l, by));
  agg.state = state;
  agg.reports = agg.reports.filter((r) => r.matchId !== m.id);
  agg.disputes = agg.disputes.map((d) =>
    d.matchId === m.id && d.status === "open" ? { ...d, status: "resolved", resolvedAt: ctx.now.toISOString(), resolution: `Result recorded: ${teamName(agg, winner)} won` } : d,
  );
  const loser = winner === m.a ? m.b : m.a;
  const scoreText = by === "forfeit" ? "by forfeit" : `${w}–${l}`;
  const source = { reports: "both captains reported", host: "entered by the host", auto: "auto-confirmed after 12 hours", dispute: "the host ruled on a dispute", forfeit: "forfeit" }[by];
  audit(effects, ctx, "result.record", `${m.id} locked: ${teamName(agg, winner)} beat ${teamName(agg, loser)} ${scoreText} (${source}).`);
  notify(effects, agg, captainsOf(agg, m.a, m.b), "result", `${m.id}: ${teamName(agg, winner)} beat ${teamName(agg, loser)} ${scoreText}.`);
  if (championDecided) {
    notify(effects, agg, [agg.host], "bracket_complete", `${teamName(agg, championDecided)} won the bracket in ${agg.name}. Close the tournament to award prizes.`);
  }
}

function done(agg: TournamentAgg, effects: Effects, message: string): Outcome {
  return { agg, effects, message };
}

/* ------------------------------------------------------------------ */
/* Check-in and start                                                  */
/* ------------------------------------------------------------------ */

export function openCheckin(agg: TournamentAgg, ctx: Ctx): Outcome {
  requireHost(agg, ctx);
  if (agg.status !== "registration") throw new OperationError("Check-in can only open during registration.", "conflict");
  const teams = Object.keys(agg.state.teams).length;
  if (teams < agg.teamCount) {
    throw new OperationError(
      agg.signupType === "solo"
        ? "Solo sign-ups need to be balanced into teams before check-in opens."
        : `Registration isn't full yet: ${teams} of ${agg.teamCount} teams.`,
      "conflict",
    );
  }
  const { next, effects } = begin(agg);
  next.status = "checkin";
  audit(effects, ctx, "checkin.open", "Opened check-in.");
  notify(effects, next, starters(next), "checkin", `Check-in is open for ${next.name}. Check in from your match page.`);
  return done(next, effects, "Check-in is open. Players were notified.");
}

function setCheckedIn(agg: TournamentAgg, teamId: string, handle: string): TournamentState {
  const team = agg.state.teams[teamId];
  if (!team) throw new OperationError("That team isn't in this tournament.", "not_found");
  if (!team.players.some((p) => p.handle === handle)) throw new OperationError(`${handle} isn't on ${team.name}.`, "not_found");
  return {
    ...agg.state,
    teams: { ...agg.state.teams, [teamId]: { ...team, players: team.players.map((p) => (p.handle === handle ? { ...p, checkedIn: true } : p)) } },
  };
}

export function checkIn(agg: TournamentAgg, ctx: Ctx): Outcome {
  if (agg.status !== "checkin") throw new OperationError("Check-in isn't open.", "conflict");
  const teamId = teamOf(agg, ctx.actor);
  if (!teamId) throw new OperationError("You aren't on a team in this tournament.", "forbidden");
  const { next, effects } = begin(agg);
  next.state = setCheckedIn(agg, teamId, ctx.actor);
  audit(effects, ctx, "checkin.self", `${ctx.actor} checked in for ${teamName(next, teamId)}.`);
  return done(next, effects, "You're checked in.");
}

export function markCheckedIn(agg: TournamentAgg, ctx: Ctx, teamId: string, handle: string): Outcome {
  requireHost(agg, ctx);
  requireOpen(agg);
  const { next, effects } = begin(agg);
  next.state = setCheckedIn(agg, teamId, handle);
  audit(effects, ctx, "checkin.host", `Marked ${handle} (${teamName(next, teamId)}) as checked in.`);
  return done(next, effects, `${handle} is checked in.`);
}

export function replaceWithSub(agg: TournamentAgg, ctx: Ctx, teamId: string, handle: string, subHandle: string): Outcome {
  requireHost(agg, ctx);
  requireOpen(agg);
  const team = agg.state.teams[teamId];
  if (!team) throw new OperationError("That team isn't in this tournament.", "not_found");
  const idx = team.players.findIndex((p) => p.handle === handle);
  if (idx < 0) throw new OperationError(`${handle} isn't on ${team.name}.`, "not_found");
  const sub = agg.subs.find((s) => s.handle === subHandle);
  if (!sub) throw new OperationError(`${subHandle} isn't on the free-agent list.`, "not_found");
  const { next, effects } = begin(agg);
  const players = [...team.players];
  players[idx] = { ...sub, checkedIn: true };
  const captain = team.captain === handle ? sub.handle : team.captain;
  next.state = { ...agg.state, teams: { ...agg.state.teams, [teamId]: { ...team, players, captain } } };
  next.subs = agg.subs.filter((s) => s.handle !== subHandle);
  audit(effects, ctx, "roster.sub", `Replaced ${handle} with sub ${subHandle} on ${team.name}.`);
  notify(effects, next, [subHandle], "roster", `You're playing for ${team.name} in ${next.name}.`);
  notify(effects, next, [handle], "roster", `You were replaced on ${team.name} in ${next.name} after missing check-in.`);
  return done(next, effects, `${subHandle} joins ${team.name}.`);
}

/** Number of scheduling waves the format needs (generous for double elimination). */
function waveCount(agg: TournamentAgg): number {
  const n = agg.state.slots.length;
  const rounds = Math.log2(n);
  if (agg.state.format === "double") return rounds * 2 + 1;
  if (agg.state.format === "groups") return rounds + 1;
  return Math.max(1, Math.round(rounds));
}

export function startTournament(agg: TournamentAgg, ctx: Ctx): Outcome {
  requireHost(agg, ctx);
  if (agg.status !== "checkin" && agg.status !== "registration") throw new OperationError("This tournament has already started.", "conflict");
  const { next, effects } = begin(agg);
  next.status = "live";
  next.schedule = makeSchedule(ctx.now.toISOString(), agg.matchWindowHours, waveCount(agg));
  const missing = Object.values(agg.state.teams).flatMap((t) => t.players.filter((p) => !p.checkedIn)).length;
  audit(effects, ctx, "tournament.start", `Started the tournament.${missing ? ` ${missing} player(s) hadn't checked in.` : ""}`);
  notify(effects, next, everyone(next), "start", `${next.name} has started. Your first match and lobby instructions are on your match page.`);
  return done(next, effects, "Tournament started. Every team has their first match.");
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export function hostRecordResult(agg: TournamentAgg, ctx: Ctx, matchId: string, winner: string, w: number, l: number, forfeit = false): Outcome {
  requireHost(agg, ctx);
  requireLive(agg);
  const m = requireMatch(agg, matchId);
  const { next, effects } = begin(agg);
  applyResult(next, effects, ctx, m, winner, w, l, forfeit ? "forfeit" : "host");
  return done(next, effects, `${matchId} locked. ${teamName(next, winner)} advances.`);
}

export function reopenMatch(agg: TournamentAgg, ctx: Ctx, matchId: string): Outcome {
  requireHost(agg, ctx);
  requireLive(agg);
  const m = requireMatch(agg, matchId);
  const { next, effects } = begin(agg);
  next.state = wrapEngine(() => reopenResult(agg.state, matchId));
  audit(effects, ctx, "result.reopen", `Reopened ${matchId} (${teamName(next, m.a)} vs ${teamName(next, m.b)}).`);
  notify(effects, next, captainsOf(next, m.a, m.b), "result", `The host reopened ${matchId}. Report the result again when it's played.`);
  return done(next, effects, `${matchId} reopened.`);
}

export function submitReport(agg: TournamentAgg, ctx: Ctx, matchId: string, winner: string, w: number, l: number): Outcome {
  requireLive(agg);
  const m = requireMatch(agg, matchId);
  const team = captainOf(agg, ctx.actor);
  if (!team || (team !== m.a && team !== m.b)) throw new OperationError("Only a captain in this match can report its result.", "forbidden");
  if (resultOf(agg.state, m)) throw new OperationError(`${matchId} already has a result.`, "conflict");
  if (agg.disputes.some((d) => d.matchId === matchId && d.status === "open")) throw new OperationError(`${matchId} is in dispute. The host will decide it.`, "conflict");
  if (winner !== m.a && winner !== m.b) throw new OperationError("Pick one of the two teams as the winner.");
  const { next, effects } = begin(agg);
  next.reports = next.reports.filter((r) => !(r.matchId === matchId && r.teamId === team));
  next.reports.push({ id: ctx.newId(), matchId, teamId: team, reporter: ctx.actor, winner, w, l, createdAt: ctx.now.toISOString() });
  const outcome = evaluateReports(m, next.reports.filter((r) => r.matchId === matchId).map((r) => ({ team: r.teamId, winner: r.winner, w: r.w, l: r.l })));
  const other = team === m.a ? m.b : m.a;
  audit(effects, ctx, "report.submit", `${teamName(next, team)} reported ${matchId}: ${teamName(next, winner)} won ${w}–${l}.`);
  if (outcome.kind === "confirmed") {
    applyResult(next, effects, ctx, m, outcome.result.winner, outcome.result.w, outcome.result.l, "reports");
    return done(next, effects, "Both reports match. The result is locked.");
  }
  if (outcome.kind === "disputed") {
    next.disputes.push({ id: ctx.newId(), matchId, status: "open", createdAt: ctx.now.toISOString() });
    audit(effects, ctx, "dispute.open", `Captains reported different results for ${matchId}.`);
    notify(effects, next, [next.host], "dispute", `Dispute on ${matchId} in ${next.name}: the captains reported different results.`);
    notify(effects, next, captainsOf(next, other), "dispute", `Your report for ${matchId} doesn't match ${possessive(teamName(next, team))}. The host will decide.`);
    return done(next, effects, "Your report doesn't match the other captain's. The host will decide.");
  }
  notify(effects, next, captainsOf(next, other), "report", `${teamName(next, team)} reported ${matchId}: ${teamName(next, winner)} won ${w}–${l}. Confirm or dispute within 12 hours.`);
  return done(next, effects, "Result submitted. The other captain has 12 hours to confirm.");
}

export function resolveDispute(agg: TournamentAgg, ctx: Ctx, disputeId: string, acceptTeamId: string): Outcome {
  requireHost(agg, ctx);
  requireLive(agg);
  const d = agg.disputes.find((x) => x.id === disputeId && x.status === "open");
  if (!d) throw new OperationError("That dispute is already closed.", "not_found");
  const rep = agg.reports.find((r) => r.matchId === d.matchId && r.teamId === acceptTeamId);
  if (!rep) throw new OperationError("That team didn't report this match.", "not_found");
  const m = requireMatch(agg, d.matchId);
  const { next, effects } = begin(agg);
  applyResult(next, effects, ctx, m, rep.winner, rep.w, rep.l, "dispute");
  audit(effects, ctx, "dispute.resolve", `Ruled for ${possessive(teamName(next, acceptTeamId))} report on ${d.matchId}.`);
  return done(next, effects, `${d.matchId} decided. Both captains were notified.`);
}

export function orderReplay(agg: TournamentAgg, ctx: Ctx, disputeId: string): Outcome {
  requireHost(agg, ctx);
  requireLive(agg);
  const d = agg.disputes.find((x) => x.id === disputeId && x.status === "open");
  if (!d) throw new OperationError("That dispute is already closed.", "not_found");
  const m = requireMatch(agg, d.matchId);
  const { next, effects } = begin(agg);
  next.disputes = next.disputes.map((x) => (x.id === disputeId ? { ...x, status: "resolved", resolvedAt: ctx.now.toISOString(), resolution: "Replay ordered" } : x));
  next.reports = next.reports.filter((r) => r.matchId !== d.matchId);
  const newDeadline = new Date(ctx.now.getTime() + 24 * HOUR).toISOString();
  next.schedule = { ...agg.schedule, overrides: { ...agg.schedule.overrides, [m.id]: newDeadline } };
  audit(effects, ctx, "dispute.replay", `Ordered a replay of ${d.matchId}; new deadline in 24 hours.`);
  notify(effects, next, captainsOf(next, m.a, m.b), "dispute", `The host ordered a replay of ${d.matchId}. You have 24 hours.`);
  return done(next, effects, `Replay ordered for ${d.matchId}.`);
}

export function forfeitMatch(agg: TournamentAgg, ctx: Ctx, matchId: string, winner: string): Outcome {
  return hostRecordResult(agg, ctx, matchId, winner, 0, 0, true);
}

/* ------------------------------------------------------------------ */
/* Deadlines and extensions                                            */
/* ------------------------------------------------------------------ */

export function requestExtension(agg: TournamentAgg, ctx: Ctx, matchId: string, hours: number, reason: string): Outcome {
  requireLive(agg);
  if (!agg.allowExtensions) throw new OperationError("The host turned extensions off. A missed deadline is a forfeit.", "forbidden");
  if (!Number.isInteger(hours) || hours < 1 || hours > 72) throw new OperationError("Ask for between 1 and 72 hours.");
  const m = requireMatch(agg, matchId);
  const team = captainOf(agg, ctx.actor);
  if (!team || (team !== m.a && team !== m.b)) throw new OperationError("Only a captain in this match can ask for more time.", "forbidden");
  if (agg.extensions.some((x) => x.matchId === matchId && x.teamId === team && x.status === "pending")) {
    throw new OperationError("You already have a request waiting for this match.", "conflict");
  }
  const { next, effects } = begin(agg);
  next.extensions.push({ id: ctx.newId(), matchId, teamId: team, requestedBy: ctx.actor, hours, reason: reason.trim(), status: "pending", createdAt: ctx.now.toISOString() });
  audit(effects, ctx, "extension.request", `${teamName(next, team)} asked for ${hours} more hour(s) on ${matchId}.`);
  notify(effects, next, [next.host], "extension", `${teamName(next, team)} asked for ${hours} more hour(s) on ${matchId} in ${next.name}.`);
  return done(next, effects, "Request sent to the host.");
}

export function decideExtension(agg: TournamentAgg, ctx: Ctx, requestId: string, approve: boolean): Outcome {
  requireHost(agg, ctx);
  requireLive(agg);
  const x = agg.extensions.find((e) => e.id === requestId && e.status === "pending");
  if (!x) throw new OperationError("That request was already decided.", "not_found");
  const m = requireMatch(agg, x.matchId);
  const { next, effects } = begin(agg);
  next.extensions = next.extensions.map((e) => (e.id === requestId ? { ...e, status: approve ? "approved" : "declined", decidedAt: ctx.now.toISOString() } : e));
  if (approve) next.schedule = extendDeadline(agg.schedule, m, x.hours);
  audit(effects, ctx, approve ? "extension.approve" : "extension.decline", `${approve ? "Approved" : "Declined"} ${possessive(teamName(next, x.teamId))} request for ${x.hours} more hour(s) on ${x.matchId}.`);
  notify(effects, next, captainsOf(next, m.a, m.b), "extension", approve ? `${x.matchId} has ${x.hours} more hour(s). The new deadline is on your match page.` :`The host declined the extension on ${x.matchId}.`);
  return done(next, effects, approve ? "Approved. Both teams were notified." : "Declined. The team was notified.");
}

export function extendMatch(agg: TournamentAgg, ctx: Ctx, matchId: string, hours: number): Outcome {
  requireHost(agg, ctx);
  requireLive(agg);
  const m = requireMatch(agg, matchId);
  const { next, effects } = begin(agg);
  next.schedule = extendDeadline(agg.schedule, m, hours);
  audit(effects, ctx, "deadline.extend", `Extended ${matchId} by ${hours} hour(s).`);
  notify(effects, next, captainsOf(next, m.a, m.b), "extension", `The host gave ${matchId} ${hours} more hour(s).`);
  return done(next, effects, `${matchId} extended by ${hours} hour(s).`);
}

/* ------------------------------------------------------------------ */
/* Bracket edits                                                       */
/* ------------------------------------------------------------------ */

function slotsChanged(agg: TournamentAgg, ctx: Ctx, slots: string[], format: FormatId, action: string, summary: string): Outcome {
  const { next, effects } = begin(agg);
  const moved = slots.filter((s, i) => s !== agg.state.slots[i]);
  next.state = { ...agg.state, slots, format };
  audit(effects, ctx, action, summary);
  const affected = format !== agg.state.format ? Object.keys(agg.state.teams) : moved;
  notify(effects, next, captainsOf(next, ...affected), "bracket", `The bracket for ${next.name} changed: ${summary}`);
  return done(next, effects, summary);
}

export function swapTeams(agg: TournamentAgg, ctx: Ctx, a: number, b: number): Outcome {
  requireHost(agg, ctx);
  requireOpen(agg);
  const r = swapSlots(agg.state, a, b);
  if (!r.ok) throw new OperationError(r.reason, "conflict");
  return slotsChanged(agg, ctx, r.slots, agg.state.format, "bracket.swap", `Swapped ${teamName(agg, agg.state.slots[a])} and ${teamName(agg, agg.state.slots[b])}.`);
}

export function randomizeBracket(agg: TournamentAgg, ctx: Ctx, seed: number): Outcome {
  requireHost(agg, ctx);
  requireOpen(agg);
  const slots = randomizeSlots(agg.state, agg.state.slots, agg.state.format, seed);
  return slotsChanged(agg, ctx, slots, agg.state.format, "bracket.randomize", "Randomized every team not locked by a result.");
}

export function seedBracket(agg: TournamentAgg, ctx: Ctx): Outcome {
  requireHost(agg, ctx);
  requireOpen(agg);
  const slots = seedSlots(agg.state, agg.state.slots, agg.state.format);
  if (slots.every((s, i) => s === agg.state.slots[i])) throw new OperationError("Already seeded by rank. Nothing to change.", "conflict");
  return slotsChanged(agg, ctx, slots, agg.state.format, "bracket.seed", "Seeded open slots by verified average rank.");
}

export function transformBracket(agg: TournamentAgg, ctx: Ctx, format: FormatId): Outcome {
  requireHost(agg, ctx);
  requireOpen(agg);
  if (format === agg.state.format) throw new OperationError(`This tournament is already ${FORMAT_NAMES[format].toLowerCase()}.`, "conflict");
  if (!canTransform(agg.state)) throw new OperationError("Results exist past round one, so the format is locked.", "conflict");
  return slotsChanged(agg, ctx, agg.state.slots, format, "bracket.transform", `Changed the format to ${FORMAT_NAMES[format].toLowerCase()}.`);
}

export type ArrangeKind = "swap" | "randomize" | "seed" | "transform" | "undo";

/**
 * Put the bracket into an arrangement the host made on the board: any
 * reordering of the same teams, optionally in a new format. Teams locked by
 * a result must stay where they are, and the format can only change while
 * canTransform allows it. The board computes the arrangement with the same
 * engine functions (swap, randomize, seed, transform), so it can show the
 * move before the save finishes.
 */
export function arrangeBracket(agg: TournamentAgg, ctx: Ctx, slots: string[], format: FormatId, kind: ArrangeKind): Outcome {
  requireHost(agg, ctx);
  requireOpen(agg);
  if (agg.status === "registration") throw new OperationError("The bracket is drawn when check-in opens.", "conflict");
  const current = agg.state.slots;
  if (slots.length !== current.length || [...slots].sort().join() !== [...current].sort().join()) {
    throw new OperationError("That arrangement doesn't match this tournament's teams. Reload and try again.", "conflict");
  }
  if (format !== agg.state.format && !canTransform(agg.state)) throw new OperationError("Results exist past round one, so the format is locked.", "conflict");
  const locked = lockedSlots(agg.state, current, agg.state.format);
  for (const i of locked) {
    if (slots[i] !== current[i]) throw new OperationError(`${teamName(agg, current[i])} has a confirmed result, so it is locked in place.`, "conflict");
  }
  const moved = slots.map((s, i) => (s !== current[i] ? i : -1)).filter((i) => i >= 0);
  if (!moved.length && format === agg.state.format) throw new OperationError("Nothing changed.", "conflict");
  let summary: string;
  if (kind === "swap" && moved.length === 2) summary = `Swapped ${teamName(agg, current[moved[0]])} and ${teamName(agg, current[moved[1]])}.`;
  else if (kind === "randomize") summary = "Randomized every team not locked by a result.";
  else if (kind === "seed") summary = "Seeded open slots by verified average rank.";
  else if (format !== agg.state.format) summary = `Changed the format to ${FORMAT_NAMES[format].toLowerCase()}.`;
  else if (kind === "undo") summary = "Undid the last bracket change.";
  else summary = `Moved ${moved.length} team${moved.length === 1 ? "" : "s"}.`;
  return slotsChanged(agg, ctx, slots, format, `bracket.${kind}`, summary);
}

/* ------------------------------------------------------------------ */
/* Closing and cancelling                                              */
/* ------------------------------------------------------------------ */

export interface CloseRequest extends CloseInput {
  message: string;
  prize?: { name: string; claim: string };
}

export function closeTournament(agg: TournamentAgg, ctx: Ctx, req: CloseRequest): Outcome {
  requireHost(agg, ctx);
  if (agg.status !== "live") throw new OperationError("Only a live tournament can be closed.", "conflict");
  const bracket = buildBracket(agg.state);
  let fp;
  try {
    fp = finalPlaces(bracket, req);
  } catch (e) {
    throw new OperationError((e as Error).message);
  }
  const message = req.message.trim();
  if (!message) throw new OperationError("Write a message to send to everyone.");
  if (req.prize && !req.prize.name.trim()) throw new OperationError("Name the prize, or remove it.");
  const { next, effects } = begin(agg);
  next.status = "complete";
  next.closure = { at: ctx.now.toISOString(), method: fp.method, places: fp.places, message, prize: req.prize ? { name: req.prize.name.trim(), claim: req.prize.claim.trim() } : undefined };

  if (agg.entryFeeCents > 0) {
    const pool = prizePoolCents(agg.entryFeeCents, agg.state.slots.length, agg.withholdPct);
    const releaseAt = payoutReleaseAt(ctx.now.toISOString()).toISOString();
    for (const prize of allocatePrizes(pool, agg.payoutSplit, fp.places)) {
      const team = agg.state.teams[prize.teamId];
      for (const share of playerShares(prize.cents, team.players.map((p) => p.handle))) {
        if (share.cents > 0) next.payouts.push({ handle: share.handle, teamId: prize.teamId, place: prize.place, cents: share.cents, releaseAt, status: "pending" });
      }
    }
  }

  const winners = fp.places[0].map((t) => teamName(next, t)).join(" and ");
  audit(effects, ctx, "tournament.close", `Closed the tournament (${fp.method === "bracket" ? "winner decided by the bracket" : fp.method === "standings" ? "by current standings" : fp.method === "co_winners" ? "co-winners chosen by the host" : "winner chosen by the host"}). Winners: ${winners}.`);
  notify(effects, next, everyone(next), "closed", message);
  const winnerHandles = fp.places[0].flatMap((t) => next.state.teams[t].players.map((p) => p.handle));
  for (const h of winnerHandles) {
    const share = next.payouts.filter((p) => p.handle === h).reduce((s, p) => s + p.cents, 0);
    const parts = [`You won ${next.name}!`];
    if (share) parts.push(`Your share is ${formatCents(share)}, claimable after the 24-hour dispute window.`);
    if (next.closure.prize) parts.push(`Prize: ${next.closure.prize.name}. ${next.closure.prize.claim}`);
    effects.notices.push({ recipient: h, kind: "win", body: parts.join(" "), link: link(next) });
  }
  return done(next, effects, `Closed. ${winners} won. Everyone was notified.`);
}

export function cancelTournament(agg: TournamentAgg, ctx: Ctx, reason: string): Outcome {
  requireHost(agg, ctx);
  requireOpen(agg);
  if (!reason.trim()) throw new OperationError("Give a reason. It's sent to every player.");
  const { next, effects } = begin(agg);
  next.status = "cancelled";
  next.cancelReason = reason.trim();
  audit(effects, ctx, "tournament.cancel", `Cancelled the tournament: ${next.cancelReason}`);
  const refund = agg.entryFeeCents > 0 ? " Entry fees are being refunded to the original payment method." : "";
  notify(effects, next, everyone(next), "cancelled", `${next.name} was cancelled. ${next.cancelReason}${refund}`);
  return done(next, effects, agg.entryFeeCents > 0 ? "Cancelled. Refunds were started and everyone was notified." : "Cancelled. Everyone was notified.");
}

export function claimPayout(agg: TournamentAgg, ctx: Ctx): Outcome {
  const mine = agg.payouts.filter((p) => p.handle === ctx.actor);
  if (!mine.length) throw new OperationError("You don't have a prize in this tournament.", "not_found");
  const ready = mine.filter((p) => p.status === "claimable");
  if (!ready.length) {
    if (mine.every((p) => p.status === "claimed")) throw new OperationError("You already claimed this prize.", "conflict");
    throw new OperationError("Your prize unlocks when the 24-hour dispute window closes.", "conflict");
  }
  const { next, effects } = begin(agg);
  next.payouts = next.payouts.map((p) => (p.handle === ctx.actor && p.status === "claimable" ? { ...p, status: "claimed" } : p));
  const total = ready.reduce((s, p) => s + p.cents, 0);
  audit(effects, ctx, "payout.claim", `${ctx.actor} claimed ${formatCents(total)}.`);
  return done(next, effects, `${formatCents(total)} claimed. It's on its way to your payout account.`);
}

/* ------------------------------------------------------------------ */
/* Background jobs                                                     */
/* ------------------------------------------------------------------ */

/**
 * Auto-confirm lone reports older than 12 hours, and unlock payouts whose
 * dispute window has passed. Returns null when there's nothing to do.
 */
export function runDueJobs(agg: TournamentAgg, now: Date): Outcome | null {
  const ctx: Ctx = { now, actor: "Scheme", newId: () => "" };
  const { next, effects } = begin(agg);
  let changed = false;
  if (agg.status === "live") {
    const bracket = buildBracket(agg.state);
    const byMatch = new Map<string, typeof agg.reports>();
    for (const r of agg.reports) byMatch.set(r.matchId, [...(byMatch.get(r.matchId) ?? []), r]);
    for (const [matchId, reps] of byMatch) {
      if (reps.length !== 1) continue;
      if (agg.disputes.some((d) => d.matchId === matchId && d.status === "open")) continue;
      if (autoConfirmAt(reps[0].createdAt) > now) continue;
      const m = findMatch(bracket, matchId);
      if (!m || !m.a || !m.b || resultOf(next.state, m)) continue;
      applyResult(next, effects, ctx, m, reps[0].winner, reps[0].w, reps[0].l, "auto");
      changed = true;
    }
  }
  if (agg.payouts.some((p) => p.status === "pending" && Date.parse(p.releaseAt) <= now.getTime())) {
    next.payouts = next.payouts.map((p) => (p.status === "pending" && Date.parse(p.releaseAt) <= now.getTime() ? { ...p, status: "claimable" } : p));
    const handles = [...new Set(next.payouts.filter((p) => p.status === "claimable").map((p) => p.handle))];
    notify(effects, next, handles, "payout", `Your prize from ${next.name} is ready to claim.`);
    audit(effects, ctx, "payout.release", `Released payouts to ${handles.length} player(s).`);
    changed = true;
  }
  return changed ? done(next, effects, "Background jobs ran.") : null;
}

/** Building blocks shared with the registration and community operations. */
export { audit, begin, done, everyone, notify, requireHost, teamName };
