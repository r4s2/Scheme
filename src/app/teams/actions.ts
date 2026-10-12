"use server";

import { revalidatePath } from "next/cache";
import type { GameId } from "@/engine";
import { OperationError, type Roster } from "@/server/model";
import * as rosters from "@/server/rosters";
import { DatabaseUnavailableError, getStore } from "@/server/store";
import { currentActor } from "@/server/session";

export interface TeamResult {
  ok: boolean;
  message: string;
  at: number;
}

/** Saved-team changes from the Teams page: create, invite, answer an invite, remove or leave, hand over captaincy. */
export async function teamAction(_prev: TeamResult | null, fd: FormData): Promise<TeamResult> {
  const at = Date.now();
  const actor = await currentActor();
  if (!actor) return { ok: false, message: "Sign in to manage teams.", at };
  const store = getStore();
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  try {
    let out: rosters.RosterOutcome;
    const op = s("op");
    if (op === "create") {
      const [me] = await store.profiles([actor]);
      out = rosters.createRoster(crypto.randomUUID(), me, s("name"), s("game") as GameId);
    } else {
      const r: Roster | null = await store.roster(s("rosterId"));
      if (!r) throw new OperationError("That team doesn't exist any more.", "not_found");
      if (op === "invite") out = rosters.invite(r, actor, (await store.profiles([s("handle")]))[0], s("handle"), s("role") || null);
      else if (op === "accept" || op === "decline") out = rosters.respond(r, actor, op === "accept");
      else if (op === "remove") out = rosters.removeMember(r, actor, s("handle"));
      else if (op === "captain") out = rosters.makeCaptain(r, actor, s("handle"));
      else throw new OperationError("Unknown action.");
    }
    await store.saveRoster(out.roster);
    await store.notify(out.notices);
    revalidatePath("/teams");
    return { ok: true, message: out.message, at };
  } catch (e) {
    if (e instanceof OperationError || e instanceof DatabaseUnavailableError) return { ok: false, message: e.message, at };
    throw e;
  }
}
