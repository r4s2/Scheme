"use server";

import { revalidatePath } from "next/cache";
import { changed } from "@/server/data";
import { getStore } from "@/server/store";
import { currentActor } from "@/server/session";

/** Turn "looking for a team" on or off for yourself. Captains see you as recruitable on the Teams page. */
export async function setLookingForTeam(fd: FormData) {
  const actor = await currentActor();
  if (!actor) return;
  await getStore().setLookingForTeam(actor, fd.get("on") === "1");
  changed();
  revalidatePath(`/u/${actor}`);
  revalidatePath("/teams");
}
