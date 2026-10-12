"use server";

import { revalidatePath } from "next/cache";
import { GAMES, maxScore, type GameId } from "@/engine";
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

export interface PoolResult {
  ok: boolean;
  message: string;
  at: number;
}

function refresh(actor: string) {
  changed();
  revalidatePath(`/u/${actor}`);
  revalidatePath("/teams");
  revalidatePath("/");
}

/**
 * Add a game to your pool, or update one: account name, rank and roles.
 * Ranks entered here are self-reported; a verified account keeps the name and
 * rank its publisher reports, and only its roles change.
 */
export async function saveGame(_prev: PoolResult | null, fd: FormData): Promise<PoolResult> {
  const at = Date.now();
  const actor = await currentActor();
  if (!actor) return { ok: false, message: "Sign in to edit your game pool.", at };
  const game = String(fd.get("game") ?? "") as GameId;
  const G = GAMES[game];
  if (!G) return { ok: false, message: "Pick a game.", at };
  const accountName = String(fd.get("accountName") ?? "").trim().replace(/\s+/g, " ");
  if (accountName.length < 3 || accountName.length > 40) {
    return { ok: false, message: `Enter your ${game === "ow" ? "BattleTag" : game === "mr" ? "Marvel Rivals UID" : "Riot ID"} (3 to 40 characters).`, at };
  }
  const tier = Number(fd.get("tier"));
  const division = Number(fd.get("division") ?? 0);
  if (!Number.isInteger(tier) || tier < 0 || tier >= G.tiers.length) return { ok: false, message: "Pick your rank.", at };
  if (!Number.isInteger(division) || division < 0 || division >= G.divisions.length) return { ok: false, message: "Pick your division.", at };
  const rankScore = tier === G.tiers.length - 1 ? maxScore(game) : tier * G.divisions.length + division;
  const roles = [...new Set(fd.getAll("roles").map(String))].filter((r) => G.roleOptions.includes(r));
  if (!roles.length) return { ok: false, message: "Pick at least one role you play.", at };

  const store = getStore();
  const [me] = await store.profiles([actor]);
  if (!me) return { ok: false, message: "Your profile wasn't found.", at };
  const had = me.accounts.find((a) => a.game === game);
  try {
    await store.saveGameAccount(me.handle, { game, accountName, rankScore, roles, source: "self" });
  } catch (e) {
    // The database refuses a second profile linking the same account.
    if ((e as { code?: string }).code === "23505") return { ok: false, message: "That account is already linked to another Scheme profile.", at };
    throw e;
  }
  refresh(me.handle);
  return {
    ok: true,
    message: had ? (had.source === "api" ? `Updated your ${G.name} roles. Your verified rank stays as reported.` : `Updated your ${G.name} account.`) : `Added ${G.name} to your game pool.`,
    at,
  };
}

/** Remove a game from your pool. Events you're already registered for keep the rank you entered with. */
export async function removeGame(_prev: PoolResult | null, fd: FormData): Promise<PoolResult> {
  const at = Date.now();
  const actor = await currentActor();
  if (!actor) return { ok: false, message: "Sign in to edit your game pool.", at };
  const game = String(fd.get("game") ?? "") as GameId;
  if (!GAMES[game]) return { ok: false, message: "Pick a game.", at };
  await getStore().removeGameAccount(actor, game);
  refresh(actor);
  return { ok: true, message: `Removed ${GAMES[game].name} from your game pool.`, at };
}
