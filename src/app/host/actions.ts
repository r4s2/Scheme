"use server";

import { revalidatePath } from "next/cache";
import { changed } from "@/server/data";
import { createTournament, type Draft } from "@/server/create";
import { OperationError } from "@/server/model";
import { DatabaseUnavailableError, getStore } from "@/server/store";
import { currentActor } from "@/server/session";

export type PublishResult = { ok: true; id: string; message: string } | { ok: false; message: string };

/** Publish the wizard's draft. Runs every check again on the server. */
export async function publishTournament(draft: Draft): Promise<PublishResult> {
  const actor = await currentActor();
  if (!actor) return { ok: false, message: "Sign in to host a tournament." };
  const store = getStore();
  try {
    const [host] = await store.profiles([actor]);
    const out = createTournament(draft, { now: new Date(), actor, newId: () => crypto.randomUUID() }, host);
    const saved = await store.create(out.agg, out.effects);
    changed();
    revalidatePath("/");
    return { ok: true, id: saved.id, message: out.message };
  } catch (e) {
    if (e instanceof OperationError || e instanceof DatabaseUnavailableError) return { ok: false, message: e.message };
    throw e;
  }
}
