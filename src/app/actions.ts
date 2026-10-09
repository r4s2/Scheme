"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getStore } from "@/server/store";
import { ACTOR_COOKIE, actingAsEnabled, currentActor } from "@/server/session";

/** Development-only: switch who you're acting as, then return to the same page. */
export async function setActor(formData: FormData) {
  if (!actingAsEnabled()) return;
  const handle = String(formData.get("handle") ?? "").trim();
  const jar = await cookies();
  if (handle) jar.set(ACTOR_COOKIE, handle, { path: "/", sameSite: "lax", httpOnly: true });
  const ref = (await headers()).get("referer");
  let back = "/";
  if (ref) {
    try {
      const u = new URL(ref);
      back = u.pathname + (u.searchParams.get("tab") ? `?tab=${encodeURIComponent(u.searchParams.get("tab")!)}` : "");
    } catch {
      back = "/";
    }
  }
  redirect(back);
}

export async function markNotificationsRead() {
  const actor = await currentActor();
  if (actor) await getStore().markAllRead(actor);
  redirect("/notifications");
}
