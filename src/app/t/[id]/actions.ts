"use server";

import { revalidatePath } from "next/cache";
import type { CloseMethod, FormatId, TournamentState } from "@/engine";
import { OperationError, type Ctx, type Outcome, type TournamentAgg } from "@/server/model";
import * as op from "@/server/operations";
import * as community from "@/server/community";
import * as reg from "@/server/registration";
import { ConflictError, DatabaseUnavailableError, getStore, type Store } from "@/server/store";
import { currentActor } from "@/server/session";

const FORMATS: FormatId[] = ["single", "double", "rr", "swiss", "groups"];
const METHODS: CloseMethod[] = ["bracket", "pick", "co_winners", "standings"];

function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  if (typeof v !== "string" || !v.trim()) throw new OperationError(`Missing ${name}.`);
  return v.trim();
}
const num = (fd: FormData, name: string) => {
  const n = Number(field(fd, name));
  if (!Number.isFinite(n)) throw new OperationError(`${name} must be a number.`);
  return n;
};

/** Map a form submission to an operation. Every operation checks its own permissions. */
async function dispatch(name: string, agg: TournamentAgg, ctx: Ctx, fd: FormData, store: Store): Promise<Outcome> {
  switch (name) {
    case "registerTeam": {
      let players: unknown;
      try {
        players = JSON.parse(field(fd, "players"));
      } catch {
        throw new OperationError("The roster couldn't be read.");
      }
      if (!Array.isArray(players) || !players.every((p) => p && typeof p.handle === "string" && typeof p.role === "string")) throw new OperationError("The roster couldn't be read.");
      const entry = { name: field(fd, "name"), players: players as { handle: string; role: string }[] };
      return reg.registerTeam(agg, ctx, entry, await store.profiles(entry.players.map((p) => p.handle).filter(Boolean)));
    }
    case "withdrawTeam":
      return reg.withdrawTeam(agg, ctx, field(fd, "teamId"));
    case "joinSolo":
      return reg.joinSolo(agg, ctx, field(fd, "role"), (await store.profiles([ctx.actor]))[0]);
    case "leaveSolo":
      return reg.leaveSolo(agg, ctx);
    case "buildTeams":
      return reg.buildSoloTeams(agg, ctx);
    case "announce":
      return community.postAnnouncement(agg, ctx, String(fd.get("body") ?? ""), fd.get("audience") === "captains" ? "captains" : "all");
    case "openTicket":
      return community.openTicket(agg, ctx, { category: field(fd, "category"), subject: String(fd.get("subject") ?? ""), body: String(fd.get("body") ?? ""), matchId: String(fd.get("matchId") ?? "") });
    case "replyTicket":
      return community.replyTicket(agg, ctx, field(fd, "ticketId"), String(fd.get("body") ?? ""));
    case "closeTicket":
      return community.closeTicket(agg, ctx, field(fd, "ticketId"));
    case "openCheckin":
      return op.openCheckin(agg, ctx);
    case "checkIn":
      return op.checkIn(agg, ctx);
    case "markCheckedIn":
      return op.markCheckedIn(agg, ctx, field(fd, "teamId"), field(fd, "handle"));
    case "replaceWithSub":
      return op.replaceWithSub(agg, ctx, field(fd, "teamId"), field(fd, "handle"), field(fd, "sub"));
    case "start":
      return op.startTournament(agg, ctx);
    case "recordResult": {
      const [w, l] = field(fd, "score").split("-").map(Number);
      return op.hostRecordResult(agg, ctx, field(fd, "matchId"), field(fd, "winner"), w, l, fd.get("forfeit") === "on");
    }
    case "reopen":
      return op.reopenMatch(agg, ctx, field(fd, "matchId"));
    case "report": {
      const [winner, w, l] = field(fd, "result").split("|");
      return op.submitReport(agg, ctx, field(fd, "matchId"), winner, Number(w), Number(l));
    }
    case "resolveDispute":
      return op.resolveDispute(agg, ctx, field(fd, "disputeId"), field(fd, "teamId"));
    case "replay":
      return op.orderReplay(agg, ctx, field(fd, "disputeId"));
    case "confirmReport": {
      const r = agg.reports.find((x) => x.id === field(fd, "reportId"));
      if (!r) throw new OperationError("That report is gone. Reload the page.", "not_found");
      return op.hostRecordResult(agg, ctx, r.matchId, r.winner, r.w, r.l);
    }
    case "forfeit":
      return op.forfeitMatch(agg, ctx, field(fd, "matchId"), field(fd, "winner"));
    case "extend":
      return op.extendMatch(agg, ctx, field(fd, "matchId"), num(fd, "hours"));
    case "requestExtension":
      return op.requestExtension(agg, ctx, field(fd, "matchId"), num(fd, "hours"), String(fd.get("reason") ?? ""));
    case "decideExtension":
      return op.decideExtension(agg, ctx, field(fd, "requestId"), field(fd, "decision") === "approve");
    case "swap":
      return op.swapTeams(agg, ctx, num(fd, "a"), num(fd, "b"));
    case "randomize":
      return op.randomizeBracket(agg, ctx, Date.now());
    case "seed":
      return op.seedBracket(agg, ctx);
    case "arrange": {
      const f = field(fd, "format") as FormatId;
      if (!FORMATS.includes(f)) throw new OperationError("Unknown format.");
      const kind = field(fd, "kind") as op.ArrangeKind;
      if (!["swap", "randomize", "seed", "transform", "undo"].includes(kind)) throw new OperationError("Unknown change.");
      let slots: unknown;
      try {
        slots = JSON.parse(field(fd, "slots"));
      } catch {
        throw new OperationError("That arrangement couldn't be read.");
      }
      if (!Array.isArray(slots) || !slots.every((x) => typeof x === "string")) throw new OperationError("That arrangement couldn't be read.");
      return op.arrangeBracket(agg, ctx, slots, f, kind);
    }
    case "transform": {
      const f = field(fd, "format") as FormatId;
      if (!FORMATS.includes(f)) throw new OperationError("Unknown format.");
      return op.transformBracket(agg, ctx, f);
    }
    case "close": {
      const method = field(fd, "method") as CloseMethod;
      if (!METHODS.includes(method)) throw new OperationError("Pick how the tournament should end.");
      const prizeName = String(fd.get("prizeName") ?? "").trim();
      return op.closeTournament(agg, ctx, {
        method,
        pick: String(fd.get("pick") ?? "") || undefined,
        coWinners: fd.getAll("coWinners").map(String),
        message: String(fd.get("message") ?? ""),
        prize: fd.get("prizeOn") === "on" ? { name: prizeName, claim: String(fd.get("prizeClaim") ?? "") } : undefined,
      });
    }
    case "cancel":
      return op.cancelTournament(agg, ctx, String(fd.get("reason") ?? ""));
    case "claim":
      return op.claimPayout(agg, ctx);
    default:
      throw new OperationError("Unknown action.");
  }
}

export interface OpResult {
  ok: boolean;
  message: string;
  /** Distinguishes two identical results, so the page shows each one. */
  at: number;
  /** The tournament after the operation (or as it stands, if it was refused), for the bracket board. */
  state?: TournamentState;
  version?: number;
}

/**
 * Run one tournament operation from a form or the bracket board and report
 * back, without navigating: the page refreshes its data in place and shows
 * the message as a notice. If the form sends the version it was showing and
 * someone else saved since, nothing changes and the latest state comes back.
 */
export async function runOp(_prev: OpResult | null, fd: FormData): Promise<OpResult> {
  const id = String(fd.get("tournamentId") ?? "");
  const name = String(fd.get("op") ?? "");
  const actor = await currentActor();
  const store = getStore();
  const agg = await store.get(id);
  const at = Date.now();
  if (!agg) return { ok: false, message: "That tournament no longer exists.", at };
  const latest = { state: agg.state, version: agg.version };
  if (!actor) return { ok: false, message: "Sign in to do that.", at, ...latest };
  const seen = fd.get("version");
  if (seen !== null && Number(seen) !== agg.version) {
    return { ok: false, message: "Someone else changed this tournament a moment ago. You're now seeing the latest.", at, ...latest };
  }
  try {
    const out = await dispatch(name, agg, { now: new Date(), actor, newId: () => crypto.randomUUID() }, fd, store);
    const saved = await store.commit(agg, out);
    revalidatePath(`/t/${id}`);
    return { ok: true, message: out.message, at, state: saved.state, version: saved.version };
  } catch (e) {
    if (!(e instanceof OperationError) && !(e instanceof ConflictError) && !(e instanceof DatabaseUnavailableError)) throw e;
    const fresh = e instanceof ConflictError ? await store.get(id) : null;
    revalidatePath(`/t/${id}`);
    return { ok: false, message: e.message, at, ...(fresh ? { state: fresh.state, version: fresh.version } : latest) };
  }
}
