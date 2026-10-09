"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import type { CloseMethod, FormatId } from "@/engine";
import { OperationError, type Ctx, type Outcome, type TournamentAgg } from "@/server/model";
import * as op from "@/server/operations";
import { ConflictError, DatabaseUnavailableError, getStore } from "@/server/store";
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
function dispatch(name: string, agg: TournamentAgg, ctx: Ctx, fd: FormData): Outcome {
  switch (name) {
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

export async function runOperation(fd: FormData) {
  const id = String(fd.get("tournamentId") ?? "");
  const name = String(fd.get("op") ?? "");
  const tab = String(fd.get("tab") ?? "");
  const actor = await currentActor();
  const store = getStore();
  const agg = await store.get(id);
  if (!agg) notFound();

  let ok = true;
  let message: string;
  if (!actor) {
    ok = false;
    message = "Sign in to do that.";
  } else {
    try {
      const out = dispatch(name, agg, { now: new Date(), actor, newId: () => crypto.randomUUID() }, fd);
      await store.commit(agg, out);
      message = out.message;
    } catch (e) {
      if (!(e instanceof OperationError) && !(e instanceof ConflictError) && !(e instanceof DatabaseUnavailableError)) throw e;
      ok = false;
      message = e.message;
    }
  }
  revalidatePath(`/t/${id}`);
  const qs = new URLSearchParams();
  if (tab) qs.set("tab", tab);
  qs.set(ok ? "msg" : "err", message);
  redirect(`/t/${id}?${qs.toString()}`);
}
